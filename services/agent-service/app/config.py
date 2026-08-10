"""Runtime settings, read from the environment at call time.

Read per call rather than at import, so a test can set one variable and get the
behaviour it wants without reloading the module.

The two caps came from backend/src/ai/agentLoop.js, which §11 step 9 deleted.
Both numbers were measured there and neither reason depended on that loop:

    MAX_STEPS       4   the deepest real task is lookup → list → activity →
                        answer. A model that has not converged by four is
                        looping, not reasoning.
    MAX_TOOL_CALLS  6   the dictionary's public endpoint allows 30 requests a
                        minute across everyone. This is one turn's share.

They are separate counters. LangChain's recursion limit bounds graph steps; the
tool budget exists because of somebody else's rate limit and has to be counted
on its own.

    DEADLINE_S      20  a wall clock, because neither counter is one. Four steps
                        of a slow model, or six tool calls against a slow
                        dictionary, can outlast the Worker's patience while
                        every individual limit is still satisfied.

DEADLINE_S MUST STAY BELOW THE WORKER'S AGENT_SERVICE_TIMEOUT_MS. The Worker
gives up at 25s by default and degrades to the cards. Without a deadline here
the container carries on past that — finishing model calls nobody will read,
spending provider budget on an abandoned request, and holding a Cloud Run
instance that `max_instances: 2` cannot spare. Two settings, in two repositories,
that have to move together.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_HSK_URL = "https://hsk-mcp.linsnotes.com/mcp"


@dataclass(frozen=True)
class Settings:
    provider: str
    model: str
    base_url: str | None
    api_key: str | None
    temperature: float
    max_steps: int
    max_tool_calls: int
    deadline_s: float
    hsk_url: str
    hsk_timeout: float


def _int(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, "") or fallback)
    except ValueError:
        return fallback


def settings() -> Settings:
    return Settings(
        # "openai" covers anything OpenAI-compatible, which is how the Worker
        # reaches SEA-LION too (backend/src/ai/providers/openaiCompat.js).
        provider=os.environ.get("AI_PROVIDER", "openai"),
        model=os.environ.get("AI_TUTOR_MODEL", "") or os.environ.get("AI_MODEL", ""),
        base_url=os.environ.get("AI_BASE_URL") or None,
        api_key=os.environ.get("AI_API_KEY") or None,
        temperature=float(os.environ.get("AI_TEMPERATURE", "0.3")),
        max_steps=_int("AGENT_MAX_STEPS", 4),
        max_tool_calls=_int("AGENT_MAX_TOOL_CALLS", 6),
        deadline_s=float(os.environ.get("AGENT_DEADLINE_S", "20")),
        hsk_url=os.environ.get("HSK_MCP_URL", DEFAULT_HSK_URL),
        hsk_timeout=float(os.environ.get("HSK_TIMEOUT_S", "8")),
    )
