"""The tool allowlist is one list, written in two languages.

`backend/src/services/tutor.js` decides what the tutor may do; `app/schemas.py`
mirrors the names so a malformed request fails at the edge with a 422 instead of
halfway through a model call. Nothing else makes those two lists agree, and the
way they disagree is asymmetric:

  a name in the Worker but not here    every turn offering it 422s. Loud, and
                                       it takes the tutor down for everyone —
                                       validation runs before the model does.

  a name here but not in the Worker    silent. The schema accepts something the
                                       Worker will never offer and never
                                       materialise, so the list quietly claims a
                                       capability that does not exist. That is
                                       the direction that rots, because nothing
                                       fails until someone reads it as truth.

So both directions are asserted. The same habit as `classify.test.js` and
`floorPlan.test.js` in the Worker — a copy is allowed to exist as long as a test
fails when it stops being a copy — except the boundary here is JS/Python, so the
JavaScript is read as text rather than imported.

This replaces the tool half of what tests/test_prompt_parity.py did for prompts.
That file is gone with §11 step 9: the prompt now has one copy, and this list
still has two.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.schemas import TOOL_NAMES

# tests/ → agent-service/ → services/ → repo root
WORKER_TUTOR = Path(__file__).resolve().parents[3] / "backend/src/services/tutor.js"

# const ALLOWED_TOOLS = [ "…", "…" ];
ALLOWED_ARRAY = re.compile(r"const ALLOWED_TOOLS = \[(.*?)\];", re.DOTALL)
JS_STRING = re.compile(r'"([a-z][a-z0-9_]*)"')


def worker_allowlist() -> frozenset[str]:
    """The Worker's ALLOWED_TOOLS, read from source.

    Read rather than imported, because pytest cannot import JavaScript. That
    makes this brittle in one specific way: it depends on the literal shape
    `const ALLOWED_TOOLS = [...];`. If that changes the regex stops matching,
    and the assertion below turns it into a loud failure rather than an empty
    set comparing equal to nothing — which is the right direction for a parity
    check to break in.
    """
    source = WORKER_TUTOR.read_text(encoding="utf-8")

    match = ALLOWED_ARRAY.search(source)
    assert match, (
        f"Could not find `const ALLOWED_TOOLS = [...];` in {WORKER_TUTOR}. "
        "The Worker's allowlist moved or changed shape; update this parser "
        "rather than deleting the test — an unparseable list is not a matching "
        "one."
    )

    return frozenset(JS_STRING.findall(match.group(1)))


def test_the_worker_allowlist_is_readable() -> None:
    assert WORKER_TUTOR.exists(), (
        f"{WORKER_TUTOR} not found. This test assumes the monorepo layout — the "
        "Worker and the agent service live in one repository on purpose "
        "(docs/architecture.md §8.4), and this list is one of the things that "
        "keeps them honest."
    )


def test_the_two_lists_are_the_same_list() -> None:
    worker = worker_allowlist()

    assert worker == TOOL_NAMES, (
        "The tutor's tool allowlist has diverged.\n\n"
        f"  only in tutor.js:   {sorted(worker - TOOL_NAMES)}\n"
        f"  only in schemas.py: {sorted(TOOL_NAMES - worker)}\n\n"
        "A name the Worker offers and this schema rejects 422s every turn. A "
        "name this schema accepts and the Worker never offers is a capability "
        "the contract claims and nothing delivers."
    )


def test_publishing_is_in_neither() -> None:
    """The one absence that is a decision rather than an oversight.

    Publishing is the least reversible action in the app and stays a human
    click (§5). Asserted separately from the equality above because two lists
    that agree can agree on the wrong thing — adding it to both would keep this
    file green everywhere else.
    """
    for name in ("publish_flashcard_deck", "publish_challenge"):
        assert name not in TOOL_NAMES
        assert name not in worker_allowlist()
