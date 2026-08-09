"""The two system prompts are one prompt, kept in two languages.

`app/agent/prompt.py` says it is ported from `backend/src/services/tutor.js`,
and until this file existed nothing made that true. The same habit as
`classify.test.js`, which imports both copies of the classifier and fails when
they diverge — except the boundary here is JS/Python rather than
worker/browser, so the JavaScript is read as text instead of imported.

Why it earns a test rather than a comment: the prompt is where the tutor's
safety rules live, and a rule fixed in one language and forgotten in the other
is worse than a rule in neither. It looks fixed. The failure that prompted this
file was exactly that shape — the prompt told the model what to SAY when a
lookup reported found:false but never that a lookup was required first, so a
real model produced the found:false sentence without the found:false result and
asserted that 水 is not in HSK. Both copies had it, and fixing one would have
left the live Worker wrong while the tests went green.

This pins the shared text only. Everything `build()` appends per request —
numbered known words, decks, the multi-turn note — is Python-side and has no
counterpart to compare against.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.agent.prompt import SYSTEM

# tests/ → agent-service/ → services/ → repo root
WORKER_TUTOR = Path(__file__).resolve().parents[3] / "backend/src/services/tutor.js"

# const SYSTEM = [ "…", "…" ].join("\n");
SYSTEM_ARRAY = re.compile(r"const SYSTEM = \[(.*?)\]\.join\(", re.DOTALL)
JS_STRING = re.compile(r'"((?:[^"\\]|\\.)*)"')


def worker_system() -> str:
    """The Worker's SYSTEM constant, reassembled from source.

    Read rather than imported, because pytest cannot import JavaScript. That
    makes this brittle in one specific way: it depends on the shape
    `const SYSTEM = [...].join(`. If the Worker ever builds its prompt
    differently the regex stops matching, and the assertions below turn that
    into a loud failure instead of a silent pass — which is the right direction
    for a parity check to break in.
    """
    source = WORKER_TUTOR.read_text(encoding="utf-8")

    match = SYSTEM_ARRAY.search(source)
    assert match, (
        f"Could not find `const SYSTEM = [...].join(` in {WORKER_TUTOR}. "
        "The Worker's prompt moved or changed shape; update this parser rather "
        "than deleting the test — an unparseable prompt is not a matching one."
    )

    # Each element is a double-quoted JS string literal, which is also a valid
    # JSON string, so json.loads handles the escapes rather than a hand-rolled
    # unescaper getting \n or a unicode escape subtly wrong.
    lines = [json.loads(f'"{s}"') for s in JS_STRING.findall(match.group(1))]
    return "\n".join(lines)


def test_the_worker_prompt_is_readable() -> None:
    assert WORKER_TUTOR.exists(), (
        f"{WORKER_TUTOR} not found. This test assumes the monorepo layout — the "
        "Worker and the agent service live in one repository on purpose "
        "(docs/architecture.md §8.4), and the prompts are one of the things "
        "that keeps them honest."
    )


def test_prompts_are_identical() -> None:
    assert worker_system() == SYSTEM, (
        "The Worker and agent system prompts have diverged.\n\n"
        "Both must change together: docs/architecture.md §11 keeps the "
        "JavaScript tutor authoritative until step 8, so a rule added only to "
        "Python is a rule that is not enforced for anyone, and a rule added "
        "only to JavaScript disappears the moment the flag flips."
    )


@pytest.mark.parametrize(
    "rule",
    [
        # One line per safety rule the prompt is carrying, quoted closely enough
        # that a reword has to be deliberate. Rewriting the prompt is fine;
        # dropping one of these by accident is what this catches.
        "call",  # a lookup must happen before a claim about a word
        "found:false",  # the absence claim is gated on a real tool result
        "only calling save_words_to_deck",  # a claimed save is not a save
        "never offer to publish",  # publishing stays a human click
    ],
)
def test_the_load_bearing_rules_survive(rule: str) -> None:
    assert rule in SYSTEM, f"The prompt no longer contains {rule!r}."
    assert rule in worker_system(), f"The Worker prompt no longer contains {rule!r}."
