// Transport for the HSK vocabulary server.
//
// Two routes exist and both must work: the service binding (production, no IP,
// no rate limit) and the public HTTPS endpoint (local dev). The binding is
// covered by injecting a stub — env is a plain argument, so no config needed.
// The HTTPS route runs for real against the canned reply in vitest.config.mjs.
//
// The cases that matter are the ones where a failure arrives dressed as success:
// this server answers tool errors at HTTP 200, and "no such word" is an empty
// array, also at 200.

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { call, callTool, readResource } from "../src/integrations/hskMcp.js";

// Builds the wire shape the real server returns: SSE, one data line.
const sse = (result) =>
  new Response(
    "event: message\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: 1, result }) + "\n\n",
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

const toolText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });

// A stub service binding. Records what it was handed so the request shape
// can be asserted, which is the part a config file cannot verify.
function bindingEnv(respond) {
  const seen = {};
  return {
    seen,
    env: {
      HSK: {
        async fetch(request) {
          seen.method = request.method;
          seen.accept = request.headers.get("Accept");
          seen.body = JSON.parse(await request.text());
          return respond(seen.body);
        },
      },
    },
  };
}

describe("service binding route", () => {
  it("sends a stateless tools/call — no initialize, no session id", async () => {
    const { env: e, seen } = bindingEnv(() => sse(toolText({ results: [] })));
    await callTool(e, "hsk_lookup", { word: "书" });

    expect(seen.method).toBe("POST");
    expect(seen.body.method).toBe("tools/call");
    expect(seen.body.params).toEqual({ name: "hsk_lookup", arguments: { word: "书" } });
    expect(seen.body.jsonrpc).toBe("2.0");
  });

  it("names both content types — the server 406s without text/event-stream", async () => {
    const { env: e, seen } = bindingEnv(() => sse(toolText({ results: [] })));
    await callTool(e, "hsk_lookup", { word: "书" });

    expect(seen.accept).toContain("text/event-stream");
    expect(seen.accept).toContain("application/json");
  });

  it("unwraps the JSON nested inside content[0].text", async () => {
    const { env: e } = bindingEnv(() =>
      sse(toolText({ results: [{ simplified: "书", frequency_rank: 412 }] })),
    );
    const out = await callTool(e, "hsk_lookup", { word: "书" });
    expect(out.results[0].simplified).toBe("书");
    expect(out.results[0].frequency_rank).toBe(412);
  });

  it("reads a resource, for the bulk vocabulary export", async () => {
    const { env: e, seen } = bindingEnv(() =>
      sse({ contents: [{ uri: "hsk://level/1", text: JSON.stringify({ level: 1, words: [] }) }] }),
    );
    const out = await readResource(e, "hsk://level/1");

    expect(seen.body.method).toBe("resources/read");
    expect(seen.body.params).toEqual({ uri: "hsk://level/1" });
    expect(out.level).toBe(1);
  });
});

describe("failures that arrive dressed as success", () => {
  it("throws on isError:true rather than returning the error string as data", async () => {
    // Real shape: HTTP 200, no JSON-RPC error field, message buried in text.
    const { env: e } = bindingEnv(() =>
      sse({ isError: true, content: [{ type: "text", text: "MCP error -32602: bad args" }] }),
    );

    await expect(callTool(e, "hsk_lookup", { word: 5 })).rejects.toThrow(/-32602|bad args/);
  });

  it("does not leak the raw error string into a caller's data path", async () => {
    const { env: e } = bindingEnv(() =>
      sse({ isError: true, content: [{ type: "text", text: "MCP error -32602: nope" }] }),
    );

    const out = await callTool(e, "hsk_lookup", { word: 5 }).catch((err) => err);
    expect(out).toBeInstanceOf(Error);
    expect(out.status).toBe(502);
  });

  it("passes an empty result through as data — a miss is not an error here", async () => {
    // The caller must be able to tell "not in the dataset" apart from a fault,
    // so this resolves. services/hsk.js turns it into an explicit not-found.
    const { env: e } = bindingEnv(() => sse(toolText({ results: [], next_cursor: null })));
    const out = await callTool(e, "hsk_lookup", { word: "zzzzqqq" });
    expect(out.results).toEqual([]);
  });

  it("surfaces a JSON-RPC error", async () => {
    const { env: e } = bindingEnv(
      () =>
        new Response(
          "event: message\ndata: " +
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no method" } }) +
            "\n\n",
          { status: 200 },
        ),
    );
    await expect(call(e, "tools/call", {})).rejects.toThrow(/no method/);
  });
});

describe("transport faults", () => {
  it("maps 429 to a distinct status so callers can back off", async () => {
    const { env: e } = bindingEnv(() => new Response("rate limited", { status: 429 }));
    const err = await callTool(e, "hsk_lookup", { word: "书" }).catch((x) => x);
    expect(err.status).toBe(429);
  });

  // A non-ok status from the binding is no longer an error the caller sees —
  // it means "binding unavailable", and the HTTPS path answers instead. That
  // behaviour is asserted under "HTTPS fallback route" below. The 502 mapping
  // still applies when HTTPS itself fails, which the outbound interceptor
  // cannot simulate per-test; it is exercised by the parse-failure cases above.

  it("survives a body with no data line", async () => {
    const { env: e } = bindingEnv(() => new Response("event: ping\n\n", { status: 200 }));
    await expect(callTool(e, "hsk_lookup", { word: "书" })).rejects.toThrow(/empty response/);
  });

  it("survives unparseable JSON", async () => {
    const { env: e } = bindingEnv(() => new Response("event: message\ndata: {oops\n\n", { status: 200 }));
    await expect(callTool(e, "hsk_lookup", { word: "书" })).rejects.toThrow(/unreadable/);
  });

  it("accepts a plain JSON body, if the server ever stops using SSE", async () => {
    const { env: e } = bindingEnv(() =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: toolText({ results: [1] }) }), {
        status: 200,
      }),
    );
    const out = await callTool(e, "hsk_lookup", { word: "书" });
    expect(out.results).toEqual([1]);
  });
});

describe("HTTPS fallback route", () => {
  it("works with no HSK binding, so local dev is unaffected", async () => {
    // `env` from cloudflare:test has no HSK binding — test/wrangler.test.toml
    // deliberately omits it. This goes out over fetch and is answered by the
    // canned reply in vitest.config.mjs.
    expect(env.HSK).toBeUndefined();

    const out = await callTool(env, "hsk_lookup", { word: "书" });
    expect(out.results[0].simplified).toBe("书");
    expect(out.results[0].forms[0].pinyin).toBe("shū");
  });

  // A declared-but-unconnected binding is the default state under `wrangler dev`
  // and the symptom of a wrong `service` name in production. The object exists,
  // so a truthiness check passes and every call dies against a stub. Caught by
  // an end-to-end run where enrichment silently never happened.
  it("falls through when the binding is declared but not connected", async () => {
    const out = await callTool(
      { ...env, HSK: { fetch: async () => { throw new Error("not connected"); } } },
      "hsk_lookup",
      { word: "书" },
    );
    expect(out.results[0].simplified).toBe("书"); // answered over HTTPS
  });

  it("falls through when the binding answers with an error status", async () => {
    const out = await callTool(
      { ...env, HSK: { fetch: async () => new Response("no such worker", { status: 503 }) } },
      "hsk_lookup",
      { word: "书" },
    );
    expect(out.results[0].simplified).toBe("书");
  });

  it("does not retry over HTTPS when the binding rate limits", async () => {
    // Should not happen — a binding carries no client IP — but retrying would
    // double the load on the one path that is actually limited.
    let httpsCalls = 0;
    const err = await callTool(
      {
        ...env,
        HSK: {
          fetch: async () => {
            httpsCalls++;
            return new Response("slow down", { status: 429 });
          },
        },
      },
      "hsk_lookup",
      { word: "书" },
    ).catch((x) => x);

    expect(err.status).toBe(429);
    expect(httpsCalls).toBe(1);
  });
});
