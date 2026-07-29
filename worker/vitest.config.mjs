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
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./test/wrangler.test.toml" },
      miniflare: {
        outboundService(request) {
          const url = new URL(request.url);

          // Resend — pretend the email was accepted.
          if (url.hostname === "api.resend.com") {
            return Response.json({ id: "test-email-id" }, { status: 200 });
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
