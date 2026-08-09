from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.schemas import TurnRequest

TURN_URL = "/internal/agent/turn"

ALL_TOOLS = [
    "hsk_lookup",
    "hsk_word_list",
    "hsk_search",
    "create_activity",
    "save_words_to_deck",
]


@pytest.fixture(autouse=True)
def offline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests must never reach a real service.

    The Worker has this guard at the runtime level — `outboundService` in
    backend/vitest.config.mjs intercepts every fetch and default-denies. Python
    has no such seam, and the absence was not theoretical: before this fixture
    existed, one endpoint test called the real OpenAI API and came back with a
    401 for an unset key.

    So the environment is neutered instead. A model provider that cannot be
    constructed and a dictionary host that does not resolve are both loud
    failures rather than quiet charges.
    """
    monkeypatch.setenv("AI_PROVIDER", "scripted")
    monkeypatch.setenv("HSK_MCP_URL", "http://dictionary.test.invalid/mcp")
    for leak in ("AI_API_KEY", "AI_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"):
        monkeypatch.delenv(leak, raising=False)


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def payload() -> dict[str, Any]:
    """A turn the Worker could really send.

    Deliberately a plain dict rather than a built model: these tests are about
    what survives the wire, and a model instance would skip the parsing that is
    the thing under test.
    """
    return {
        "contract_version": "1",
        "request_id": "test-123",
        "messages": [{"role": "user", "content": "Teach me 医院"}],
        "known_words": [
            {
                "i": 0,
                "simplified": "医院",
                "pinyin": "yīyuàn",
                "meaning": "hospital",
                "level": 1,
                "found": True,
                "source": "seed",
            }
        ],
        "decks": [],
        "allowed_tools": ALL_TOOLS,
        "level": 3,
    }


@pytest.fixture
def agent_config() -> Settings:
    """Settings for a test: scripted model, a dictionary URL nothing may reach.

    Named `agent_config` rather than `config` because pytest has a built-in
    fixture by that name, and shadowing it is the kind of thing that produces a
    baffling error three months from now.

    The deadline is generous here so it never fires by accident — the tests that
    are about the deadline set their own.
    """
    return Settings(
        provider="scripted",
        model="scripted",
        base_url=None,
        api_key=None,
        temperature=0.0,
        max_steps=4,
        max_tool_calls=6,
        deadline_s=30.0,
        hsk_url="http://dictionary.test.invalid/mcp",
        hsk_timeout=1.0,
    )


@pytest.fixture
def make_request() -> Any:
    def build(**overrides: Any) -> TurnRequest:
        base: dict[str, Any] = {
            "contract_version": "1",
            "request_id": "r1",
            "messages": [{"role": "user", "content": "what is 医院"}],
            "known_words": [
                {
                    "i": 0,
                    "simplified": "医院",
                    "pinyin": "yīyuàn",
                    "meaning": "hospital",
                    "level": 1,
                    "found": True,
                    "source": "seed",
                }
            ],
            "decks": [],
            "allowed_tools": ALL_TOOLS,
            "level": 3,
        }
        base.update(overrides)
        return TurnRequest(**base)

    return build


@pytest.fixture
def dictionary(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Stands in for the HSK MCP server, at the transport seam.

    Patched at `project.call_tool` rather than higher up, so the projection, the
    found:false note and the length caps are all still under test — those are
    the parts that must not drift.
    """
    calls: list[tuple[str, dict[str, Any]]] = []
    replies: dict[str, Any] = {}

    async def fake(name: str, arguments: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
        calls.append((name, arguments))
        if name in replies:
            reply = replies[name]
            if isinstance(reply, Exception):
                raise reply
            return reply
        return {"results": []}

    monkeypatch.setattr("app.hsk.project.call_tool", fake)

    class Dictionary:
        calls = None

        def answers(self, tool: str, reply: Any) -> None:
            replies[tool] = reply

    stub = Dictionary()
    stub.calls = calls  # type: ignore[assignment]
    return stub
