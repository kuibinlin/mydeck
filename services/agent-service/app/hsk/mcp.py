"""The HSK vocabulary server, over Model Context Protocol (Streamable HTTP).

Transport only — no projection, no business rules. A direct port of
backend/src/integrations/hskMcp.js, against the same server, with the same
request shape and the same two traps handled:

  * Omitting `text/event-stream` from Accept returns 406. The server will not
    fall back to plain JSON, so both types are named.
  * A TOOL failure does not arrive as a JSON-RPC error. It comes back as a
    normal result at HTTP 200 with isError:true and the message inside
    content[0].text. Checking only `error` returns the string
    "MCP error -32602: ..." as though it were dictionary data.

WHY NOT AN MCP CLIENT LIBRARY. The server is stateless — probed: `initialize`
succeeds and no `mcp-session-id` comes back — so a session-managing client would
open and tear down a session per turn to send one POST. This is the whole
protocol for this server, it is already proven against it from the Worker, and
it keeps `langchain-mcp-adapters` out of the picture, which would otherwise hand
raw 27 KB tool output straight to the model and skip the projection that exists
to prevent exactly that.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
}


class DictionaryUnavailable(RuntimeError):
    """The dictionary could not answer. Never a reason to invent one."""


async def call_tool(
    name: str,
    arguments: dict[str, Any],
    *,
    url: str,
    timeout: float,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }

    owned = client is None
    http = client or httpx.AsyncClient(timeout=timeout)
    try:
        response = await http.post(url, json=payload, headers=HEADERS)
    except httpx.HTTPError as err:
        raise DictionaryUnavailable(f"the dictionary did not respond: {err}") from err
    finally:
        if owned:
            await http.aclose()

    if response.status_code == 429:
        raise DictionaryUnavailable("the dictionary is busy right now")
    if response.status_code >= 400:
        raise DictionaryUnavailable(f"dictionary service error ({response.status_code})")

    result = _event(response.text)
    if result.get("error"):
        raise DictionaryUnavailable(result["error"].get("message", "dictionary error"))

    inner = result.get("result") or {}
    text = ((inner.get("content") or [{}])[0]).get("text", "")

    if inner.get("isError"):
        raise DictionaryUnavailable(text or "dictionary tool failed")

    return _json(text)


def _event(body: str) -> dict[str, Any]:
    """`event: message\\ndata: {…}\\n\\n` — one event, one line, not a stream."""
    stripped = body.lstrip()
    if stripped.startswith("{"):
        return _json(stripped)

    for line in body.split("\n"):
        if line.startswith("data:"):
            return _json(line[5:].strip())

    raise DictionaryUnavailable("the dictionary returned an empty response")


def _json(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError) as err:
        raise DictionaryUnavailable("the dictionary returned unreadable data") from err

    if not isinstance(parsed, dict):
        raise DictionaryUnavailable("the dictionary returned unreadable data")
    return parsed
