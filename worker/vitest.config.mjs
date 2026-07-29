import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the worker inside workerd with real (local) D1 + KV bindings,
// so these are true integration tests, not mocks.
//
// SAFETY: tests must never reach the network. Two independent guards:
//   1. test/wrangler.test.toml — separate config directory, so ../.dev.vars
//      (which holds REAL secrets) is not loaded, and no [ai] binding exists.
//   2. outboundService below — every outbound fetch from the worker is
//      intercepted here and answered locally.
// The words the canned dictionary knows. Anything else is a genuine miss, which
// is what lets a test assert the not-found path instead of guarding around it.
const KNOWN_HSK = {
  书: {
    simplified: "书",
    radical: "乙",
    frequency_rank: 412,
    levels: ["new-1", "old-1"],
    new_level: 1,
    forms: [
      {
        traditional: "書",
        pinyin: "shū",
        meanings: ["book", "letter", "to write"],
        classifiers: ["本"],
      },
    ],
  },
};

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./test/wrangler.test.toml" },
      miniflare: {
        async outboundService(request) {
          const url = new URL(request.url);

          // Resend — pretend the email was accepted.
          if (url.hostname === "api.resend.com") {
            return Response.json({ id: "test-email-id" }, { status: 200 });
          }

          // HSK vocabulary server. Tests hit the HTTPS fallback because
          // test/wrangler.test.toml has no HSK service binding — so this canned
          // reply is what exercises integrations/hskMcp.js. Shape copied from a
          // real response: text/event-stream, one `data:` line, and the payload
          // JSON nested as a *string* inside content[0].text.
          //
          // hsk_lookup answers only for words it actually knows. It used to
          // answer 书 for every word, which quietly made a whole class of test
          // meaningless: `project()` in resolve.js takes the word from
          // `hit.simplified`, so a lookup for 龘 came back as a card for 书 and
          // any assertion guarded on the word asked for could never run. A stub
          // that always succeeds cannot exercise the miss path, and the miss
          // path is the one that must never invent a meaning.
          if (url.hostname === "hsk-mcp.linsnotes.com") {
            const body = await request.clone().json().catch(() => null);
            const method = body?.method;
            const tool = body?.params?.name;
            const word = body?.params?.arguments?.word;

            const payload =
              method === "tools/call" && tool === "hsk_lookup" && !KNOWN_HSK[word]
                ? { results: [], next_cursor: null }
                : { results: [KNOWN_HSK[word] ?? KNOWN_HSK["书"]], next_cursor: null };

            const sse =
              "event: message\ndata: " +
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
              }) +
              "\n\n";
            return new Response(sse, {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            });
          }

          // Anything else means a test reached for the network unexpectedly.
          return Response.json(
            { error: `Blocked outbound request to ${url.hostname}` },
            { status: 503 },
          );
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.js"],
  },
});
