"""The dictionary: transport, and the projection that keeps it usable.

The projection is a CORRECTNESS requirement, not a size optimisation — one raw
`hsk_build_study_set` reply measured 27 KB, roughly 7,000 tokens for twenty
words, and two of those exhaust a 70B model's context. What is pinned here is
the SHAPE: only these fields, at most this many results, at most this many
characters. "27 KB became 1.1 KB" is an observation about one reply; a byte
ratio would fail the day the server adds a field nobody reads.
"""

import json
from typing import Any

import httpx
import pytest

from app.hsk import project
from app.hsk.mcp import DictionaryUnavailable, call_tool


def sse(payload: Any, *, is_error: bool = False) -> str:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "content": [{"type": "text", "text": json.dumps(payload)}],
            **({"isError": True} if is_error else {}),
        },
    }
    return "event: message\ndata: " + json.dumps(body) + "\n\n"


def transport(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


HIT = {
    "simplified": "医院",
    "radical": "匚",
    "frequency_rank": 800,
    "new_level": 1,
    "forms": [
        {
            "traditional": "醫院",
            "pinyin": "yīyuàn",
            "meanings": ["hospital", "clinic", "infirmary", "sick bay", "sanatorium"],
            "classifiers": ["家", "所", "个", "座"],
        }
    ],
}


class TestTransport:
    async def test_reads_one_sse_event(self):
        def handler(request: httpx.Request) -> httpx.Response:
            # Both content types must be named or the server answers 406 and
            # will not fall back to plain JSON.
            assert "text/event-stream" in request.headers["Accept"]
            return httpx.Response(200, text=sse({"results": [HIT]}))

        async with transport(handler) as client:
            result = await call_tool(
                "hsk_lookup", {"word": "医院"}, url="http://x/mcp", timeout=1, client=client
            )
        assert result["results"][0]["simplified"] == "医院"

    async def test_reads_plain_json_too(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text=json.dumps({"result": {"content": [{"text": "{}"}]}}))

        async with transport(handler) as client:
            assert await call_tool("t", {}, url="http://x/mcp", timeout=1, client=client) == {}

    async def test_a_tool_error_is_not_dictionary_data(self):
        """The trap this transport exists to avoid.

        A tool failure arrives as a normal result at HTTP 200 with isError:true
        and the message inside content[0].text. Checking only the JSON-RPC
        `error` field returns the string "MCP error -32602: ..." as though it
        were a definition.
        """

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text=sse("MCP error -32602: bad params", is_error=True))

        async with transport(handler) as client:
            with pytest.raises(DictionaryUnavailable, match="-32602"):
                await call_tool("t", {}, url="http://x/mcp", timeout=1, client=client)

    async def test_rate_limiting_is_named(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(429)

        async with transport(handler) as client:
            with pytest.raises(DictionaryUnavailable, match="busy"):
                await call_tool("t", {}, url="http://x/mcp", timeout=1, client=client)

    async def test_unreadable_data_is_refused(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="event: message\ndata: not json\n\n")

        async with transport(handler) as client:
            with pytest.raises(DictionaryUnavailable):
                await call_tool("t", {}, url="http://x/mcp", timeout=1, client=client)


class TestLookupProjection:
    async def test_returns_only_the_approved_fields(self, agent_config, monkeypatch):
        async def fake(name, args, **kwargs):
            return {"results": [HIT]}

        monkeypatch.setattr("app.hsk.project.call_tool", fake)
        result = await project.lookup("医院", config=agent_config)

        assert set(result) <= {
            "word",
            "found",
            "pinyin",
            "meanings",
            "level",
            "frequency_rank",
            "traditional",
            "radical",
            "classifiers",
        }

    async def test_caps_meanings_and_classifiers(self, agent_config, monkeypatch):
        async def fake(name, args, **kwargs):
            return {"results": [HIT]}

        monkeypatch.setattr("app.hsk.project.call_tool", fake)
        result = await project.lookup("医院", config=agent_config)

        # Five meanings and four classifiers came back; three of each survive.
        assert len(result["meanings"]) == 3
        assert len(result["classifiers"]) == 3

    async def test_a_miss_carries_the_instruction_not_just_a_flag(self, agent_config, monkeypatch):
        """The load-bearing one.

        A model handed an empty result invents a definition; a model handed this
        sentence says the word is not in the list.
        """

        async def fake(name, args, **kwargs):
            return {"results": []}

        monkeypatch.setattr("app.hsk.project.call_tool", fake)
        result = await project.lookup("龘", config=agent_config)

        assert result["found"] is False
        assert "do not invent" in result["note"]

    async def test_an_unreachable_dictionary_never_becomes_an_answer(
        self, agent_config, monkeypatch
    ):
        async def fake(name, args, **kwargs):
            raise DictionaryUnavailable("down")

        monkeypatch.setattr("app.hsk.project.call_tool", fake)
        result = await project.lookup("医院", config=agent_config)

        assert result["found"] is False
        assert "do not answer from memory" in result["note"]


class TestListProjection:
    async def test_projects_to_four_short_fields(self, agent_config, monkeypatch):
        async def fake(name, args, **kwargs):
            assert name == "hsk_build_study_set"
            return {"words": [HIT] * 30}

        monkeypatch.setattr("app.hsk.project.call_tool", fake)
        result = await project.word_list(1, limit=5, config=agent_config)

        assert result["count"] == 5
        assert set(result["words"][0]) == {"w", "py", "en", "lv"}
        # One meaning, not five — the rest are context nobody reads.
        assert result["words"][0]["en"] == "hospital"

    async def test_known_words_switch_the_tool(self, agent_config, monkeypatch):
        seen = {}

        async def fake(name, args, **kwargs):
            seen["name"] = name
            seen["args"] = args
            return {"words": []}

        monkeypatch.setattr("app.hsk.project.call_tool", fake)
        await project.word_list(3, known=["医院"], config=agent_config)

        # A list becomes a recommendation: "the ones you don't have yet".
        assert seen["name"] == "hsk_suggest_next"
        assert seen["args"]["known"] == ["医院"]

    async def test_excluded_words_never_come_back(self, agent_config, monkeypatch):
        async def fake(name, args, **kwargs):
            return {"words": [HIT]}

        monkeypatch.setattr("app.hsk.project.call_tool", fake)
        result = await project.word_list(1, known=["医院"], config=agent_config)
        assert result["words"] == []


class TestSearchProjection:
    async def test_uses_the_meaning_search_tool(self, agent_config, monkeypatch):
        seen = {}

        async def fake(name, args, **kwargs):
            seen["name"] = name
            return {"results": [HIT]}

        monkeypatch.setattr("app.hsk.project.call_tool", fake)
        result = await project.search("hospital", config=agent_config)

        assert seen["name"] == "hsk_search_meaning"
        assert result["words"][0]["w"] == "医院"


class TestHarvest:
    def test_reads_words_from_a_result_not_from_arguments(self):
        assert project.words_in({"found": True, "word": "医院"}) == ["医院"]
        assert project.words_in({"words": [{"w": "银行"}, {"w": "书"}]}) == ["银行", "书"]
        # A miss carries no word to trust.
        assert project.words_in({"found": False, "word": "龘"}) == []
