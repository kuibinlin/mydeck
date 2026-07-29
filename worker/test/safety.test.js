import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

// Guards against the test suite silently talking to real third-party services.
// A previous iteration of this harness loaded ../.dev.vars and made a live
// Resend API call. These assertions make that regression fail loudly.
describe("test isolation", () => {
  it("does not load real secrets from .dev.vars", () => {
    expect(env.RESEND_API_KEY).toBe("test-resend-key");
    expect(env.GITHUB_CLIENT_ID).toBe("test-client-id");
    expect(env.GITHUB_CLIENT_SECRET).toBe("test-client-secret");
    // A real Resend key starts with "re_" — assert we never hold one.
    expect(env.RESEND_API_KEY.startsWith("re_")).toBe(false);
  });

  it("has no Workers AI binding, so no test can incur inference charges", () => {
    expect(env.AI).toBeUndefined();
  });

  it("has no AI_API_KEY", () => {
    expect(env.AI_API_KEY).toBeUndefined();
  });

  it("blocks outbound requests to hosts other than the stubbed ones", async () => {
    const res = await fetch("https://api.github.com/user");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Blocked outbound request");
  });
});
