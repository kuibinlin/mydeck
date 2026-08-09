"""The three read-only tools, backed by the HSK MCP server.

Three, not thirteen. The server offers thirteen; five return data `hsk_lookup`
already carries, and folding those in would give the model five near-synonyms to
tell apart. The rest answer real but narrow questions and stay out of the
tutor's routing problem.

Descriptions carry the routing, so no two share a trigger phrase. Ported from
backend/src/tools/defs/hsk.js, where this wording measured 14/18 correct.
"""

from __future__ import annotations

from typing import Any

from langchain_core.tools import StructuredTool

from ...hsk import project
from ...schemas import KnownWord
from ..state import TurnState
from .args import HskLookupArgs, HskSearchArgs, HskWordListArgs, as_tool, dump, error

LOOKUP = (
    "Look up ONE Chinese word. Returns pinyin, English meanings, HSK level, frequency rank, "
    "radical, traditional form and measure word (classifier). Use for: what does X mean, how "
    "is X pronounced, what HSK level is X, what is the measure word for X. If it comes back "
    "found:false the word is not in the HSK vocabulary — say so plainly and do not invent a "
    "meaning or a level."
)

WORD_LIST = (
    "Get a LIST of HSK vocabulary at one level, most frequent first. Use for: give me N words "
    "at level L, what should I study next, HSK N vocabulary. Pass `known` with words the "
    "learner already has to exclude them, which turns this into a personal recommendation "
    "rather than a generic list."
)

SEARCH = (
    "Find Chinese words by their ENGLISH meaning. Use when the learner asks 'how do you say X "
    "in Chinese', or gives an English word and wants the Chinese for it. Do not use this for a "
    "word already written in Chinese — that is hsk_lookup."
)


def tools(state: TurnState) -> list[StructuredTool]:
    async def hsk_lookup(word: str) -> str:
        args = {"word": word}
        if (stop := state.check("hsk_lookup", args)) is not None:
            return error(stop)

        # Interception before the network, recording after — so an intercepted
        # lookup still spends a turn's tool budget, exactly as it does in the
        # Worker.
        if (seed := state.seeded(word)) is not None:
            state.record("hsk_lookup", ok=True, args=args)
            return dump(_from_seed(seed))

        return _finish(state, "hsk_lookup", args, await project.lookup(word, config=state.config))

    async def hsk_word_list(level: int, limit: int = 10, known: list[str] | None = None) -> str:
        args = {"level": level, "limit": limit, "known": sorted(known or [])}
        if (stop := state.check("hsk_word_list", args)) is not None:
            return error(stop)

        result = await project.word_list(level, limit=limit, known=known, config=state.config)
        return _finish(state, "hsk_word_list", args, result)

    async def hsk_search(query: str, limit: int = 6) -> str:
        args = {"query": query, "limit": limit}
        if (stop := state.check("hsk_search", args)) is not None:
            return error(stop)

        result = await project.search(query, limit=limit, config=state.config)
        return _finish(state, "hsk_search", args, result)

    return [
        as_tool(hsk_lookup, name="hsk_lookup", description=LOOKUP, args_schema=HskLookupArgs),
        as_tool(
            hsk_word_list,
            name="hsk_word_list",
            description=WORD_LIST,
            args_schema=HskWordListArgs,
        ),
        as_tool(hsk_search, name="hsk_search", description=SEARCH, args_schema=HskSearchArgs),
    ]


def _finish(state: TurnState, name: str, args: dict[str, Any], result: dict[str, Any]) -> str:
    """Record the call, harvest what it found, hand it to the model.

    The same three steps for every dictionary tool, which is why they live here
    rather than three times over.
    """
    state.record(name, ok=_useful(result), args=args)
    state.discover(project.words_in(result))
    return dump(result)


def _useful(result: dict[str, Any]) -> bool:
    """Did the call answer anything? A miss is a valid result and a failed step."""
    return bool(result.get("found") or result.get("words"))


def _from_seed(seed: KnownWord) -> dict[str, Any]:
    """A seeded word, in the shape a real lookup would have returned."""
    return {
        "word": seed.simplified,
        "found": True,
        "pinyin": seed.pinyin,
        "meanings": [seed.meaning] if seed.meaning else [],
        "level": seed.level,
        "note": "Already looked up for this turn.",
    }
