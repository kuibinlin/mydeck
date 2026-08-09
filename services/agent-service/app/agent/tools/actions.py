"""The two tools that ask for something rather than doing it.

Neither writes anything. They record an INTENDED ACTION and return a sentence —
the Worker owns D1 and performs every write (docs/architecture.md §6, §8.2).

What the model gets back is phrased as an intention too ("will be saved", not
"saved"), because the reply it writes next is the learner's account of what
happened and it must not report a write that the Worker has not performed yet.
"""

from __future__ import annotations

from langchain_core.tools import StructuredTool

from ...schemas import CreateActivityAction, SaveWordsAction
from ..state import TurnState
from .args import CreateActivityArgs, SaveWordsArgs, as_tool, dump, error

ACTIVITY_TYPES = ("stroke", "match")
MAX_TITLE = 60
MAX_DECK_NAME = 60

CREATE_ACTIVITY = (
    "Build an interactive practice activity and show it to the learner. type 'stroke' is an "
    "animated stroke-order writing sheet — use it when they want to learn to WRITE a "
    "character. type 'match' is a word/meaning matching game — use it when they want to play, "
    "practise, be quizzed or be tested. Name words by their NUMBER from the list above, or "
    "leave word_refs out and the learner's own deck is used."
)

SAVE_WORDS = (
    "Save Chinese words to one of the learner's flashcard decks so they can study them later. "
    "Use this when they ask to save, keep, remember or add words. Send everything in ONE call. "
    "LEAVE `word_refs` OUT to save the words already on screen — that is almost always what is "
    "wanted. Name the deck with `deck_name` when the learner names one; it is created if they "
    "do not have it. Every deck this makes is a private draft — the learner publishes it "
    "themselves."
)


def tools(state: TurnState) -> list[StructuredTool]:
    async def create_activity(
        type: str,  # noqa: A002 — the model's vocabulary, matching the Worker's tool
        word_refs: list[int] | None = None,
        deck_id: int | None = None,
        level: int | None = None,
        title: str | None = None,
    ) -> str:
        args = {"type": type, "word_refs": word_refs, "deck_id": deck_id, "level": level}
        if (stop := state.check("create_activity", args)) is not None:
            return error(stop)

        if type not in ACTIVITY_TYPES:
            state.record("create_activity", ok=False)
            return error(f"Unknown activity type: {type}. Use 'stroke' or 'match'.")

        refs = state.valid_refs(word_refs or [])
        state.actions.append(
            CreateActivityAction(
                type="create_activity",
                activity_type=type,  # type: ignore[arg-type]  # checked above
                word_refs=refs,
                deck_id=state.valid_deck(deck_id),
                # The learner answered this in the empty state; their answer
                # holds whether or not the model thought to pass it on.
                level=level or state.level,
                title=_trim(title, MAX_TITLE),
            )
        )
        state.record("create_activity", ok=True, args=args)

        return dump(
            {
                "requested": type,
                "words": len(refs) or "the learner's own deck",
                "note": "The activity will be on screen with your reply. Introduce it in one "
                "sentence; do not list the words.",
            }
        )

    async def save_words_to_deck(
        word_refs: list[int] | None = None,
        deck_id: int | None = None,
        deck_name: str | None = None,
    ) -> str:
        # BEFORE the allowlist check, never after.
        #
        # `saveFailed` is the only thing that can contradict a model claiming it
        # saved, and the Worker gates it on this count. The Worker learned that
        # counting after the refusal made the signal unreachable in exactly the
        # case it exists for; the same trap is here, one process away.
        state.save_attempts += 1

        args = {"word_refs": word_refs, "deck_id": deck_id, "deck_name": deck_name}
        if (stop := state.check("save_words_to_deck", args)) is not None:
            return error(stop)

        refs = state.valid_refs(word_refs or [])
        state.actions.append(
            SaveWordsAction(
                type="save_words_to_deck",
                word_refs=refs,
                deck_id=state.valid_deck(deck_id),
                deck_name=_trim(deck_name, MAX_DECK_NAME),
            )
        )
        state.record("save_words_to_deck", ok=True, args=args)

        return dump(
            {
                "requested": len(refs) or "the words already on screen",
                "note": "The deck will be saved with your reply as a private draft. Say what is "
                "being saved in one sentence, and do not offer to publish it.",
            }
        )

    return [
        as_tool(
            create_activity,
            name="create_activity",
            description=CREATE_ACTIVITY,
            args_schema=CreateActivityArgs,
        ),
        as_tool(
            save_words_to_deck,
            name="save_words_to_deck",
            description=SAVE_WORDS,
            args_schema=SaveWordsArgs,
        ),
    ]


def _trim(value: str | None, limit: int) -> str | None:
    """A bounded string, or nothing — never an empty one."""
    return (value or "").strip()[:limit] or None
