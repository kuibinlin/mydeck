"""The Worker ↔ agent contract, version 1.

This file is the artefact everything else is built against. Read
`docs/architecture.md` §6-§8 first; the short version is that the Worker owns
D1, owns authorisation, and owns every write. This service reasons, and says
what it would like done.

Four properties are structural here rather than checked somewhere later, because
each one closes a hole that a check can be forgotten in front of:

ROLES ARE ASSIGNED, NEVER READ.
    `Message.role` is user|assistant. `system` is unrepresentable, so no
    transcript arriving from a browser can be relabelled as an instruction. This
    is the same design as backend/src/services/zh/conversation.js, which builds
    {q, a} pairs and assigns roles by position — carried across the wire rather
    than re-earned on this side.

WORDS CROSS AS INDICES.
    The dictionary has no stable IDs (§7.2: `grep -c '"id"' hsk-core.json`
    returns 0) and inventing them would mean a migration every time the index is
    regenerated. So the Worker sends a numbered list and this service refers to
    positions in it. An action can only ever name a word the Worker itself
    produced.

THIS SERVICE NEVER MANUFACTURES CANONICAL CHINESE.
    Measured and documented in backend/src/services/tutor.js: this class of
    model corrupts characters it retypes — 翻译 became 翰译, 医院 became 疒馆.
    So `word_refs` are integers, and `discovered_words` (the one place
    characters travel back) is a narrow shape that the Worker re-resolves
    against its own index before anything is done with it. A corrupted
    character simply fails to resolve and is dropped, exactly as
    conversation.js already does for words carried between turns.

REFERENCE VALIDITY IS THE WORKER'S JOB, NOT THIS FILE'S.
    Nothing here checks that a `word_ref` points at a real entry, that a
    `deck_id` belongs to the caller, or that `save_words_to_deck` was offered
    this turn. Those are policy, they need state this service does not have, and
    a service that validated them would invite the Worker to trust the result.
    The Worker re-derives all of it. What this file bounds is *shape* — the same
    division services/activities.js#summariseResult already makes for
    attacker-supplied activity results.
"""

from __future__ import annotations

import re
from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# `Final` so this narrows to Literal["1"] and can satisfy the field type below
# without a cast — the constant and the schema cannot drift apart.
CONTRACT_VERSION: Final = "1"

# The tutor's allowlist, mirrored from backend/src/services/tutor.js.
#
# `publish_flashcard_deck` is absent for the reason stated there and in §5:
# publishing is the least reversible action in the app and stays a human click.
# Mirroring the list here is a schema check, NOT the policy — the Worker decides
# per turn which of these are actually offered (save_words_to_deck only when the
# learner asked to save) and re-checks every action it gets back.
TOOL_NAMES = frozenset(
    {
        "hsk_lookup",
        "hsk_word_list",
        "hsk_search",
        "create_activity",
        "save_words_to_deck",
    }
)

# Every limit below mirrors one already enforced in the Worker. Where they
# differ the Worker wins, and it re-applies all of them — these exist so a
# malformed payload fails at the edge with a 422 instead of halfway through a
# model call.
MAX_MESSAGES = 13  # 6 {q,a} pairs + the current turn — conversation.js MAX_PAIRS
MAX_MESSAGE_CHARS = 4000  # http/routes/zh.js MAX_MESSAGE_CHARS
MAX_KNOWN_WORDS = 32  # seed + carried words; conversation.js caps carried at 12
MAX_DECKS = 50
MAX_ACTIONS = 4  # agentLoop.js maxSteps — one action per step is already generous
MAX_STEPS = 6  # agentLoop.js maxToolCalls
MAX_SAVE_WORDS = 20  # services/deckSave.js MAX_SAVE
MAX_ACTIVITY_WORDS = 12  # services/activities.js MAX_ITEMS
MAX_DISCOVERED_WORDS = 24
MAX_DECK_NAME_CHARS = 60  # deckSave.js destination()
MAX_TITLE_CHARS = 60  # activities.js create()

# A Chinese word: Han characters, few enough to be one word.
#
# Deliberately narrower than the Worker's /^\p{Script=Han}{1,8}$/u — Python's
# `re` has no Unicode script classes and pulling in the `regex` module to match
# exactly is not worth a dependency. Narrower is the safe direction: this can
# only reject things the Worker would also reject, and the Worker re-applies the
# real check. Nothing that passes this can carry an instruction.
_HAN_WORD = re.compile(r"^[㐀-䶿一-鿿豈-﫿]{1,8}$")

WordRef = Annotated[int, Field(ge=0)]


class Message(BaseModel):
    """One turn of the conversation. Roles are user|assistant and nothing else."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class KnownWord(BaseModel):
    """A word the Worker has already resolved, and the only kind an action may name.

    `simplified` is not required to be Han: a lookup that missed keeps whatever
    the learner typed, which may be pinyin or English, so the model can say "not
    in the HSK list" about the thing they actually wrote. Those entries carry
    `found=False` and must not be referenced by an action — enforced Worker-side,
    where the trusted copy of this list lives.

    `source` records where the word came from, and the ORDER of this list is
    load-bearing: seeded words first, words carried from earlier turns last.
    services/deckSave.js keeps the first MAX_SAVE and drops the rest, so "save
    that" has to mean the word just discussed rather than the oldest one still
    in the conversation. Flatten the ordering and that breaks silently.
    """

    model_config = ConfigDict(extra="forbid")

    i: int = Field(ge=0)
    simplified: str = Field(min_length=1, max_length=32)
    pinyin: str = Field(default="", max_length=64)
    meaning: str = Field(default="", max_length=200)
    level: int | None = Field(default=None, ge=1, le=7)
    found: bool = True
    source: Literal["seed", "prior"]


class DeckContext(BaseModel):
    """A deck the learner owns. Sent so the model can name one without guessing.

    Phase 0 measured the model inventing a deck id it had never seen, and this
    phase measured it passing a deck's *name* into the id field. Supplying the
    real list is what removes the guess; the Worker still re-checks ownership on
    every action, because a list sent is not a permission granted.
    """

    model_config = ConfigDict(extra="forbid")

    id: int = Field(ge=1)
    name: str = Field(max_length=120)
    card_count: int = Field(default=0, ge=0)


class TurnRequest(BaseModel):
    """One tutor turn, as the Worker states it.

    There is no `system` field and no system message. The prompt is this
    service's own, composed from `level` and `known_words` — a caller that could
    supply the system prompt could also supply one that disarms the rest of it.
    """

    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["1"]
    request_id: str = Field(min_length=1, max_length=64)
    messages: list[Message] = Field(min_length=1, max_length=MAX_MESSAGES)
    known_words: list[KnownWord] = Field(default_factory=list, max_length=MAX_KNOWN_WORDS)
    decks: list[DeckContext] = Field(default_factory=list, max_length=MAX_DECKS)
    allowed_tools: list[str] = Field(min_length=1)
    level: int | None = Field(default=None, ge=1, le=7)

    @field_validator("allowed_tools")
    @classmethod
    def _known_tools_only(cls, v: list[str]) -> list[str]:
        unknown = sorted(set(v) - TOOL_NAMES)
        if unknown:
            raise ValueError(f"unknown tools: {', '.join(unknown)}")
        if len(set(v)) != len(v):
            raise ValueError("duplicate tool names")
        return v

    @model_validator(mode="after")
    def _indices_match_positions(self) -> TurnRequest:
        """`i` must equal the position it sits at.

        Stronger than "must be unique" and simpler to reason about: it makes a
        `word_ref` a plain list index on both sides of the wire, so there is no
        second lookup table to disagree about.
        """
        for position, word in enumerate(self.known_words):
            if word.i != position:
                raise ValueError(f"known_words[{position}].i is {word.i}, expected {position}")
        return self

    @model_validator(mode="after")
    def _ends_with_the_learner(self) -> TurnRequest:
        """The last message is the thing being answered.

        A payload ending on an assistant turn is either a truncated transcript or
        a request to continue the tutor's own sentence, and neither is a turn.
        """
        if self.messages[-1].role != "user":
            raise ValueError("the last message must be the learner's")
        return self


class SaveWordsAction(BaseModel):
    """Put these words in a deck.

    `word_refs` empty means "the words we have been discussing" — the same
    default services/tutor.js already applies when the model names nothing. The
    Worker resolves that against its own `knownWords()`, so an empty list is a
    complete instruction rather than a missing argument.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["save_words_to_deck"]
    word_refs: list[WordRef] = Field(default_factory=list, max_length=MAX_SAVE_WORDS)
    deck_id: int | None = Field(default=None, ge=1)
    deck_name: str | None = Field(default=None, max_length=MAX_DECK_NAME_CHARS)


class CreateActivityAction(BaseModel):
    """Build a practice round.

    `activity_type` is the Worker's vocabulary (services/activities.js), not the
    frontend's component names. `deck_id` and `level` are passed through so the
    Worker's existing resolveSource() ordering — explicit words, then a named
    deck, then their newest deck, then a level-appropriate set — keeps working
    unchanged.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["create_activity"]
    activity_type: Literal["stroke", "match"]
    word_refs: list[WordRef] = Field(default_factory=list, max_length=MAX_ACTIVITY_WORDS)
    deck_id: int | None = Field(default=None, ge=1)
    level: int | None = Field(default=None, ge=1, le=7)
    title: str | None = Field(default=None, max_length=MAX_TITLE_CHARS)


IntendedAction = Annotated[
    SaveWordsAction | CreateActivityAction,
    Field(discriminator="type"),
]


# Why a turn ended. Named so the loop can pass it around without a bare string
# and without a cast at the boundary.
#
#   answered            the model finished and wrote prose
#   step_limit          the loop or the clock ran out; whatever it said stands
#   model_error         the provider failed
#   answered_after_cap  it spent every step on tools, then answered when asked
StopReason = Literal["answered", "step_limit", "model_error", "answered_after_cap"]


class Step(BaseModel):
    """What the loop did, for the client's step display and for logs."""

    model_config = ConfigDict(extra="forbid")

    tool: str = Field(max_length=64)
    ok: bool


class Usage(BaseModel):
    """What the turn cost.

    `model_calls` is the only field the Worker acts on: it writes one
    ai_usage_log row per call, because AI_DAILY_LIMIT_FREE counts model calls
    rather than requests and a four-step turn should cost four. Token counts are
    recorded but not yet metered.
    """

    model_config = ConfigDict(extra="forbid")

    model_calls: int = Field(ge=0)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)


class TurnResponse(BaseModel):
    """What the agent would like the Worker to do, and what to say about it."""

    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["1"]
    request_id: str = Field(min_length=1, max_length=64)
    message: str = Field(default="", max_length=MAX_MESSAGE_CHARS)
    intended_actions: list[IntendedAction] = Field(default_factory=list, max_length=MAX_ACTIONS)

    # Words this turn learned from a tool RESULT — never from model output.
    #
    # This is what keeps hsk_search useful: a word discovered mid-turn is not in
    # the Worker's known_words, so without this it could never be saved. The
    # Worker re-resolves each one through lookupLocal before using it, which is
    # the same treatment conversation.js gives words carried between turns, and
    # is why a corrupted character costs one dropped word rather than a wrong
    # flashcard.
    discovered_words: list[str] = Field(default_factory=list, max_length=MAX_DISCOVERED_WORDS)

    # How many times the model asked to save, INCLUDING attempts that were
    # refused or dropped.
    #
    # Not an implementation detail: `saveFailed` is the only thing in the app
    # that can contradict a model claiming it saved, and it is gated on this
    # counter. services/tutor.js increments before its allowlist check, with a
    # comment recording that counting after the refusal made the signal
    # unreachable in exactly the case it exists for. Counting only executed
    # calls here reintroduces that across the wire.
    save_attempts: int = Field(default=0, ge=0)

    stopped_by: StopReason = "answered"
    steps: list[Step] = Field(default_factory=list, max_length=MAX_STEPS)
    usage: Usage

    @field_validator("discovered_words")
    @classmethod
    def _han_only(cls, v: list[str]) -> list[str]:
        for word in v:
            if not _HAN_WORD.match(word):
                raise ValueError(f"not a word: {word!r}")
        return v
