"""HSK vocabulary, shaped for a model to read.

Everything here projects hard before returning, and that is a CORRECTNESS
requirement rather than a size optimisation. Measured on the live server from
the Worker: one raw `hsk_build_study_set` reply is 27 KB — roughly 7,000 tokens
for twenty words. Two of those and a 70B model's context is gone.

The invariant is the SHAPE, not the ratio. "27 KB became 1.1 KB" is an
observation about one reply; what is pinned below and in the tests is: only
these fields, at most this many results, at most this many characters. A future
server change cannot quietly widen it.

The dropped fields — Wade-Giles, Bopomofo, Romatzyh, rarity class, meanings past
the third — are a real capability given up. The way to get them back is a
dedicated tool, not a wider default.

NOT-FOUND IS AN INSTRUCTION, NOT A FLAG. A model handed an empty result invents
a definition; a model handed the sentence below says the word is not in the
list. Ported verbatim from backend/src/services/hsk.js for that reason.
"""

from __future__ import annotations

from typing import Any

from ..config import Settings
from .mcp import DictionaryUnavailable, call_tool

NOT_FOUND_NOTE = (
    "Not in the HSK vocabulary list. Say so plainly — do not invent a meaning, level or frequency."
)

UNAVAILABLE_NOTE = (
    "The dictionary could not be reached, so this word is unverified. Say you "
    "could not look it up — do not answer from memory."
)

MAX_MEANINGS = 3
MAX_CLASSIFIERS = 3
MAX_LIST = 20
MAX_SEARCH = 10
MAX_TEXT = 120


def _text(value: Any, limit: int = MAX_TEXT) -> str:
    return str(value or "")[:limit]


def _level(hit: dict[str, Any]) -> int | None:
    level = hit.get("new_level") or hit.get("old_level")
    return level if isinstance(level, int) and 1 <= level <= 7 else None


async def lookup(word: str, *, config: Settings) -> dict[str, Any]:
    """One word, richest available, projected."""
    trimmed = word.strip()
    if not trimmed:
        return {"word": "", "found": False, "note": NOT_FOUND_NOTE}

    try:
        raw = await call_tool(
            "hsk_lookup", {"word": trimmed}, url=config.hsk_url, timeout=config.hsk_timeout
        )
    except DictionaryUnavailable:
        return {"word": trimmed, "found": False, "note": UNAVAILABLE_NOTE}

    results = raw.get("results") or []
    if not results:
        return {"word": trimmed, "found": False, "note": NOT_FOUND_NOTE}

    hit = results[0]
    form = (hit.get("forms") or [{}])[0]
    meanings = [_text(m) for m in (form.get("meanings") or [])[:MAX_MEANINGS]]

    projected: dict[str, Any] = {
        "word": _text(hit.get("simplified") or trimmed, 32),
        "found": True,
        "pinyin": _text(form.get("pinyin"), 64),
        "meanings": meanings,
        "level": _level(hit),
    }

    rank = hit.get("frequency_rank")
    if isinstance(rank, int):
        projected["frequency_rank"] = rank
    if form.get("traditional"):
        projected["traditional"] = _text(form["traditional"], 32)
    if hit.get("radical"):
        projected["radical"] = _text(hit["radical"], 8)
    if form.get("classifiers"):
        projected["classifiers"] = [_text(c, 8) for c in form["classifiers"][:MAX_CLASSIFIERS]]

    return projected


def _entry(row: dict[str, Any], fallback_level: int | None = None) -> dict[str, Any]:
    form = (row.get("forms") or [{}])[0]
    meanings = form.get("meanings") or row.get("meanings") or []
    return {
        "w": _text(row.get("simplified"), 32),
        "py": _text(form.get("pinyin") or row.get("pinyin"), 64),
        "en": _text(meanings[0] if meanings else ""),
        "lv": row.get("new_level") or fallback_level,
    }


async def word_list(
    level: int, *, limit: int = 10, known: list[str] | None = None, config: Settings
) -> dict[str, Any]:
    """A level's vocabulary, most frequent first.

    `known` turns this into a recommendation rather than a list — the difference
    between "here are HSK 4 words" and "here are the ones you don't have yet".
    """
    exclude = {w.strip() for w in (known or []) if w and w.strip()}
    want = min(max(limit, 1), MAX_LIST)

    tool = "hsk_suggest_next" if exclude else "hsk_build_study_set"
    args: dict[str, Any] = (
        {"level": level, "scheme": "new", "known": sorted(exclude)}
        if exclude
        else {"level": level, "scheme": "new"}
    )

    try:
        raw = await call_tool(tool, args, url=config.hsk_url, timeout=config.hsk_timeout)
    except DictionaryUnavailable as err:
        return {"level": level, "count": 0, "words": [], "note": str(err)}

    rows = raw.get("words") or raw.get("results") or []
    words = [
        _entry(row, level)
        for row in rows
        if row.get("simplified") and row["simplified"] not in exclude
    ][:want]

    return {"level": level, "count": len(words), "words": words}


async def search(query: str, *, limit: int = 6, config: Settings) -> dict[str, Any]:
    """English meaning to Chinese words."""
    trimmed = query.strip()
    if not trimmed:
        return {"query": "", "words": []}

    try:
        raw = await call_tool(
            "hsk_search_meaning",
            {"query": trimmed},
            url=config.hsk_url,
            timeout=config.hsk_timeout,
        )
    except DictionaryUnavailable as err:
        return {"query": trimmed, "words": [], "note": str(err)}

    rows = raw.get("results") or []
    words = [_entry(row) for row in rows if row.get("simplified")][: min(limit, MAX_SEARCH)]
    return {"query": trimmed, "words": words}


def words_in(result: dict[str, Any]) -> list[str]:
    """The Chinese this result actually carries.

    Read from the projected RESULT, never from the model's arguments — that is
    the whole difference between a discovered word being trustworthy and being
    a retyped guess.
    """
    found: list[str] = []
    if result.get("found") and result.get("word"):
        found.append(str(result["word"]))
    for row in result.get("words") or []:
        if row.get("w"):
            found.append(str(row["w"]))
    return found
