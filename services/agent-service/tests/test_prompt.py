"""The prompt still carries the rules it is carried for.

This file is what is left of tests/test_prompt_parity.py, which held the Worker's
copy of the system prompt and this one together by reading tutor.js as text.
§11 step 9 deleted the Worker's loop and with it the second copy, so there is
nothing to compare against any more — the duplication is gone, which is a better
outcome than a test that watched it.

What does not go away is the reason that test existed. The prompt is where the
tutor's safety rules live, and they are prose: nothing else in the system fails
when one is quietly reworded out. The parametrised case below is the same
assertion the parity file made about the load-bearing lines, minus the half that
had a second copy to check.

Most of what `build()` appends per request — decks, the multi-turn note — is
asserted in test_agent.py against a real run. The one exception is below: the
numbering instruction is not in the constant, and it is the one line here with
no Worker-side enforcement behind it.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.agent.prompt import SYSTEM, build

# One entry per safety rule the prompt carries, quoted as a whole clause.
#
# The first two are one rule in two halves, and the gap between them is a
# measured failure: the prompt said what to SAY when a lookup reported
# found:false but never that a lookup had to happen, so a real model produced
# the sentence without the result and asserted that 水 is not in HSK.
#
# Quoted as CLAUSES, not words, and that is the whole design of this file. The
# first entry was once the bare word "call", which the prompt satisfies in its
# opening line — "a flashcard app called MyDeck" — so the rule it was guarding
# could be deleted with this test still green. A pin that matches incidental
# prose is worse than no pin: it reports a rule is present when it is gone.
# `test_the_pins_are_phrases` is what stops that coming back.
RULES = [
    "call hsk_lookup before saying anything about it",
    "when a tool actually reported found:false",
    "only calling save_words_to_deck",
    "never offer to publish",
]


def _flat(text: str) -> str:
    """Whitespace-insensitive, so rewrapping the prompt is not a failure.

    The prompt is wrapped prose and the rules span line breaks — "call\\nhsk_lookup"
    is one clause the file happens to print on two lines. Rewrapping is an
    edit this test should permit; deleting a rule is not.
    """
    return " ".join(text.split())


@pytest.mark.parametrize("rule", RULES)
def test_the_load_bearing_rules_survive(rule: str) -> None:
    assert _flat(rule) in _flat(SYSTEM), f"The prompt no longer contains {rule!r}."


@pytest.mark.parametrize("rule", RULES)
def test_the_pins_are_phrases(rule: str) -> None:
    """The guard on the guard.

    Every rule above must be a multi-word clause specific enough that ordinary
    prose cannot satisfy it by accident. Asserted rather than trusted, because
    the failure it prevents is silent: a weakened pin does not fail, it just
    stops testing, and the suite stays green for however long it takes someone
    to read it.
    """
    assert " " in rule, f"{rule!r} is a single word — pin the clause, not a word in it."
    assert len(rule) >= 20, f"{rule!r} is too short to be specific to its rule."


def test_the_numbering_rule_reaches_the_model(make_request: Any) -> None:
    """The one instruction with no Worker-side enforcement to fall back on.

    Every rule above is belt-and-braces: the Worker re-checks word refs, deck
    ownership and save intent whatever the model was told (§8.2). Numbering is
    different — told to name words instead of numbering them, the model retypes
    Chinese, and this model corrupts Chinese it retypes. The schema then rejects
    the action rather than correcting it, so the turn simply fails.

    Asserted against `build()` rather than SYSTEM because it lives in the
    per-request words block: no known words, no instruction, which is correct —
    there would be nothing to number.
    """
    prompt = build(make_request())

    assert "[0] 医院" in prompt
    assert "word_refs" in prompt
    assert "Never retype the characters" in prompt
