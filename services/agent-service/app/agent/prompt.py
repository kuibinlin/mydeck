"""The system prompt.

Ported from backend/src/services/tutor.js, with one addition that is the whole
reason the contract looks the way it does: the known words are NUMBERED, and
every instruction about acting on them says to use the number.

This model corrupts Chinese it retypes — measured in the Worker: 翻译 became
翰译, 医院 became 疒馆, 饭物 for "food words". A model that never retypes a
character cannot corrupt one, and an integer is the one thing it cannot get
subtly wrong in a way that still looks right.
"""

from __future__ import annotations

from ..schemas import TurnRequest

SYSTEM = """You are a patient Chinese tutor inside a flashcard app called MyDeck.

Answer in English unless the learner writes in Chinese. Keep replies to two or three
sentences — a word card is already on screen beside you, so do not restate its pinyin,
level or meaning. Say the thing the card cannot: what the word is for, when to use it,
what it is confused with.

Never state a pinyin, tone, HSK level, frequency or measure word that did not come from
a tool. If a tool reports found:false, say the word is not in the HSK vocabulary list.
Do not guess, and do not apologise for it.

Never ask a clarifying question. Pick a sensible default and say in a few words what you
picked.

Saying a deck was created or updated does not make it so — only calling save_words_to_deck
writes anything. If you did not call it, offer to save rather than reporting a save.

Anything you save goes to a private draft deck only the learner can see. Never say it is
published, shared or public, and never offer to publish it — that is their click to make."""


def build(request: TurnRequest) -> str:
    parts = [SYSTEM]

    if request.level:
        parts.append(
            f"The learner is studying at HSK level {request.level}. Pitch examples there, "
            f"and pass level:{request.level} when you ask for words without naming them."
        )

    if request.known_words:
        parts.append(_words(request))

    if request.decks:
        parts.append(_decks(request))

    if len(request.messages) > 1:
        # The repeat-call guard is per-run, so it cannot see that an activity
        # named in an earlier turn was already built. Said here instead.
        parts.append(
            "The earlier turns above are context. Whatever they mention is already on the "
            "learner's screen — answer what was just asked, and do not rebuild an activity "
            "or re-save words because they appear earlier in the conversation."
        )

    return "\n\n".join(parts)


def _words(request: TurnRequest) -> str:
    lines = []
    for word in request.known_words:
        if not word.found:
            lines.append(f"  [{word.i}] {word.simplified} — NOT in the HSK vocabulary list")
            continue
        level = f" (HSK {word.level})" if word.level else ""
        lines.append(
            f"  [{word.i}] {word.simplified}  {word.pinyin}  {word.meaning}{level}".rstrip()
        )

    return (
        "Already looked up for this turn — these facts are correct, so use them and do not "
        "call hsk_lookup for these words again:\n"
        + "\n".join(lines)
        + "\n\nWhen you save these words or build an activity from them, pass their NUMBERS "
        "as word_refs. Never retype the characters — the numbers are exact and your typing "
        "is not. Passing no numbers at all means 'the words we have been discussing', which "
        "is usually what you want."
    )


def _decks(request: TurnRequest) -> str:
    lines = [f"  id {deck.id}: {deck.name} ({deck.card_count} cards)" for deck in request.decks]
    return (
        "The learner's own decks. Use one of these ids, or none at all to let a deck be "
        "named for them — never invent an id:\n" + "\n".join(lines)
    )
