// HSK vocabulary server, over Model Context Protocol (Streamable HTTP).
//
// Transport only — no caching, no projection, no business rules. Those live in
// services/hsk.js, so an HTTP route and an agent tool share one implementation.
//
// Two routes to the same server, and which one is used matters:
//
//   env.HSK        service binding, worker-to-worker. No DNS, no TLS, no public
//                  IP — and therefore no per-IP rate limit.
//   HTTPS          the public endpoint, rate limited to 30 requests/minute PER
//                  IP. Behind one Worker every user shares a handful of egress
//                  IPs, so that ceiling is GLOBAL: ten concurrent learners at
//                  three lookups each is already 3x over. The binding is a
//                  correctness requirement, not an optimisation. HTTPS exists
//                  for local dev, where the binding is unavailable.
//
// The server is stateless: no `initialize` handshake, no session id. One POST
// per call is the whole protocol.

import { AppError, badGateway, tooManyRequests } from "../services/errors.js";

const PUBLIC_URL = "https://hsk-mcp.linsnotes.com/mcp";
const TIMEOUT_MS = 8000;

// Omitting text/event-stream returns 406 — the server will not fall back to
// plain JSON, so both types must be named.
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

export async function call(env, method, params = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await send(env, body);

  if (res.status === 429)
    throw tooManyRequests("The dictionary is busy right now");
  if (!res.ok) throw badGateway(`Dictionary service error (${res.status})`);

  const payload = parseEvent(await res.text());
  if (payload.error)
    throw badGateway(payload.error.message || "Dictionary error");

  return payload.result;
}

// A tool call, unwrapped to the JSON its text content carries.
//
// Tool-level failures do NOT arrive as a JSON-RPC error — they come back as a
// normal result with isError:true and the message inside content[0].text, at
// HTTP 200. Checking only payload.error silently returns the string
// "MCP error -32602: ..." as though it were dictionary data.
export async function callTool(env, name, args = {}) {
  const result = await call(env, "tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text ?? "";

  if (result?.isError) throw badGateway(text || "Dictionary tool failed");

  return parseJson(text);
}

// A resource read. Used to bulk-export the vocabulary for the offline index —
// seven calls instead of 574 paginated tool calls.
export async function readResource(env, uri) {
  const result = await call(env, "resources/read", { uri });
  return parseJson(result?.contents?.[0]?.text ?? "");
}

// Binding first, HTTPS as the guaranteed path.
//
// The binding object is present whenever it is *declared*, even when it is not
// connected — `wrangler dev` prints "local [not connected]" and calls through it
// fail in a couple of milliseconds. So its existence proves nothing, and a
// truthiness check on env.HSK silently disables the only working route: in dev
// permanently, and in production for as long as a wrong `service` name survives.
//
// Hence: attempt the binding, and treat anything other than a real answer as
// "binding unavailable" and fall through. A wrong service name then costs
// latency instead of correctness, and says so in the logs.
async function send(env, body) {
  const request = () =>
    new Request("https://hsk-mcp/mcp", { method: "POST", headers: HEADERS, body });

  if (env.HSK?.fetch) {
    try {
      const res = await env.HSK.fetch(request());
      // 429 cannot come from a binding (no client IP to limit), but pass it
      // through rather than retrying and doubling the load if it ever does.
      if (res.ok || res.status === 429) return res;
      console.warn(`[hsk] binding answered ${res.status} — falling back to HTTPS`);
    } catch (err) {
      console.warn(`[hsk] binding unavailable (${err?.message ?? err}) — falling back to HTTPS`);
    }
  }

  try {
    return await fetch(PUBLIC_URL, {
      method: "POST",
      headers: HEADERS,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw badGateway("The dictionary did not respond");
  }
}

// `event: message\ndata: {…}\n\n` — one event, one line. Not an incremental
// stream, so there is no reader loop here on purpose.
function parseEvent(body) {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) return parseJson(trimmed); // plain JSON mode, if ever enabled

  const line = body.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw badGateway("The dictionary returned an empty response");
  return parseJson(line.slice(5).trim());
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw badGateway("The dictionary returned unreadable data");
  }
}
