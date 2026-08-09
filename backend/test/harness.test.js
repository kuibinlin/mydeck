import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { requestJson, createUserWithSession } from "./helpers";

// Sanity checks for the harness itself — schema applied, bindings present,
// sessions readable. If these fail, every other test failure is noise.
describe("harness", () => {
  it("applies the schema to D1", async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    ).first();
    expect(row?.name).toBe("users");
  });

  it("has AI and KV bindings", () => {
    expect(env.SESSIONS).toBeDefined();
    expect(env.DB).toBeDefined();
  });

  it("authenticates via a KV session cookie", async () => {
    const { user, token } = await createUserWithSession({
      email: "harness@example.com",
      username: "harness",
    });
    const { status, data } = await requestJson("/auth/me", { token });
    expect(status).toBe(200);
    expect(data.user.username).toBe("harness");
    expect(data.user.id).toBe(user.id);
  });

  it("rejects an unauthenticated request", async () => {
    const { status } = await requestJson("/auth/me");
    expect(status).toBe(401);
  });
});
