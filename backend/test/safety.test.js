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
    expect(env.AGENT_SERVICE_SECRET).toBe("test-agent-secret");
    // A real Resend key starts with "re_" — assert we never hold one.
    expect(env.RESEND_API_KEY.startsWith("re_")).toBe(false);
  });

  it("points the agent service at the stubbed host, not a real one", () => {
    // Any other host reaches the default-deny below rather than the scenario
    // stub, so a typo here would silently turn every agent test into a 503.
    //
    // This matters more since §11 step 9 than it did before it. There used to
    // be a second implementation in this process and a set of flags choosing
    // between them, so a mispointed URL fell through to the JavaScript loop and
    // the suite stayed green. Now this host is the only tutor there is.
    expect(env.AGENT_SERVICE_URL).toBe("https://agent.test.invalid");
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
