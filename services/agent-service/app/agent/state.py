"""Everything one turn accumulates, and every guard that reads it.

The framework runs the loop. It does not know about any of this, and none of it
is optional:

    the tool allowlist, enforced where tools RUN
    the tool-call budget, separate from the step limit
    repeat detection, so a model asking twice gets an answer, not a second call
    seed interception, so a resolved word is never looked up again
    save attempts, counted before a refusal
    discovered words, harvested from RESULTS and never from arguments

Registering a tool with an agent decides what is ADVERTISED. What is advertised
and what can be called are different questions, and the Worker learned that the
hard way — backend/src/services/tutor.js carries the comment.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from ..config import Settings
from ..schemas import (
    CreateActivityAction,
    DeckContext,
    KnownWord,
    SaveWordsAction,
    Step,
    TurnRequest,
)

# Same rule as schemas.py and the Worker's conversation.js: Han, short enough to
# be one word. Nothing that fails this can carry an instruction.
HAN_WORD = re.compile(r"^[㐀-䶿一-鿿豈-﫿]{1,8}$")

UNKNOWN_TOOL = "Unknown tool: {name}"
NO_BUDGET = "No more tool calls are available this turn. Answer the learner now."
REPEATED = (
    "You already called this with the same arguments. The result is above — answer the learner now."
)

IntendedAction = SaveWordsAction | CreateActivityAction


@dataclass
class TurnState:
    """One turn's counters, guards and results.

    Built per request. Every tool closes over the instance for THIS turn, which
    is what lets a guard know what the learner actually asked for.
    """

    config: Settings
    allowed: frozenset[str]
    known: list[KnownWord]
    decks: list[DeckContext]
    level: int | None

    tool_calls: int = 0
    save_attempts: int = 0
    steps: list[Step] = field(default_factory=list)
    actions: list[IntendedAction] = field(default_factory=list)
    discovered: list[str] = field(default_factory=list)

    _seen: set[str] = field(default_factory=set)

    @classmethod
    def from_request(cls, request: TurnRequest, config: Settings) -> TurnState:
        return cls(
            config=config,
            allowed=frozenset(request.allowed_tools),
            known=list(request.known_words),
            decks=list(request.decks),
            level=request.level,
        )

    # --- the gate every tool passes through -------------------------------

    def check(self, name: str, args: dict[str, Any]) -> str | None:
        """None if the call may proceed, otherwise what to tell the model.

        One call rather than three, because the ORDER matters and scattering it
        across each tool is how one of them ends up in the wrong order.

        Allowlist first: a model emitting a name it was never offered —
        trained-in, hallucinated, or steered there by pasted text — must not
        reach a tool just because the tool exists in this process.

        Then the budget, then repeats. Answering a repeat from here costs
        nothing and breaks a cycle: a weak model's most common failure is asking
        for the same thing twice. It doubles as the only rate-limit relief this
        service has, since the dictionary's public endpoint allows 30 requests a
        minute across every caller.
        """
        if name not in self.allowed:
            return UNKNOWN_TOOL.format(name=name)
        if self.tool_calls >= self.config.max_tool_calls:
            return NO_BUDGET
        if self._key(name, args) in self._seen:
            return REPEATED
        return None

    def record(self, name: str, *, ok: bool, args: dict[str, Any] | None = None) -> None:
        """A call happened. `args` marks it so a repeat is answered from here."""
        self.tool_calls += 1
        self.steps.append(Step(tool=name, ok=ok))
        if args is not None:
            self._seen.add(self._key(name, args))

    @staticmethod
    def _key(name: str, args: dict[str, Any]) -> str:
        return f"{name}:{json.dumps(args, sort_keys=True, ensure_ascii=False)}"

    # --- trusted words ----------------------------------------------------

    def seeded(self, word: str) -> KnownWord | None:
        """A word the Worker already resolved for this turn.

        Interception is a guarantee, not a request. The prompt asks the model not
        to look these up again; measured in the Worker, it does anyway. Two
        things it buys: the round trip and its share of a rate budget shared with
        every other user, and the certainty that a word the learner typed is
        answered from the characters they typed rather than the model's copy.
        """
        target = word.strip()
        return next(
            (e for e in self.known if e.found and e.simplified == target),
            None,
        )

    def valid_refs(self, refs: list[int]) -> list[int]:
        """Indices that name a word we actually have, deduplicated.

        Filtered rather than rejected. A reference to nothing is a mistake by
        definition, and the fallback — "the words we have been discussing" — is a
        better answer than failing the turn. Same reasoning as the Worker falling
        back to the whole list when the model names a word that resolves to
        nothing.
        """
        out: list[int] = []
        for ref in refs:
            if 0 <= ref < len(self.known) and self.known[ref].found and ref not in out:
                out.append(ref)
        return out

    def valid_deck(self, deck_id: int | None) -> int | None:
        """A deck the Worker offered this turn, or nothing.

        The Worker refuses any id it did not send, so passing one through would
        cost the whole response. Dropped here instead.
        """
        if deck_id is None:
            return None
        return deck_id if any(deck.id == deck_id for deck in self.decks) else None

    def discover(self, words: list[str]) -> None:
        """Words a tool RESULT carried that the Worker had not already sent.

        The characters came from the dictionary, not from the model, which is the
        only reason they are safe to send back at all — and the Worker still
        re-resolves every one before using it.
        """
        have = {entry.simplified for entry in self.known}
        for word in words:
            if word not in have and word not in self.discovered and HAN_WORD.match(word):
                self.discovered.append(word)
