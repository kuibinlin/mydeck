import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  request,
  requestJson,
  createUser,
  createUserWithSession,
  ADMIN_EMAIL,
} from "./helpers";

// Outbound fetch is stubbed by outboundService in vitest.config.mjs —
// api.resend.com returns 200, everything else is blocked with 503.

describe("POST /auth/login", () => {
  it("rejects a missing email", async () => {
    const { status, data } = await requestJson("/auth/login", {
      method: "POST",
      body: {},
    });
    expect(status).toBe(400);
    expect(data.error).toBe("Email is required");
  });

  it("rejects a malformed email", async () => {
    const { status, data } = await requestJson("/auth/login", {
      method: "POST",
      body: { email: "not-an-email" },
    });
    expect(status).toBe(400);
    expect(data.error).toBe("Invalid email address");
  });

  it("asks for a username when the user is new", async () => {
    const { status, data } = await requestJson("/auth/login", {
      method: "POST",
      body: { email: "new@example.com" },
    });
    expect(status).toBe(200);
    expect(data.needsUsername).toBe(true);
  });

  it("rejects a username that is already taken", async () => {
    await createUser({ email: "taken@example.com", username: "taken" });
    const { status, data } = await requestJson("/auth/login", {
      method: "POST",
      body: { email: "other@example.com", username: "taken" },
    });
    expect(status).toBe(409);
    expect(data.error).toBe("Username already taken");
  });

  it("creates the user and stores a magic token", async () => {
    const { status, data } = await requestJson("/auth/login", {
      method: "POST",
      body: { email: "fresh@example.com", username: "fresh" },
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    const user = await env.DB.prepare(
      "SELECT username FROM users WHERE email = ?",
    )
      .bind("fresh@example.com")
      .first();
    expect(user.username).toBe("fresh");

    const keys = await env.SESSIONS.list({ prefix: "magic:" });
    expect(keys.keys.length).toBe(1);
  });

  it("sends a login link for an existing user without re-creating them", async () => {
    await createUser({ email: "exists@example.com", username: "exists" });
    const { status, data } = await requestJson("/auth/login", {
      method: "POST",
      body: { email: "exists@example.com" },
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    const { n } = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM users WHERE email = ?",
    )
      .bind("exists@example.com")
      .first();
    expect(n).toBe(1);
  });
});

describe("GET /auth/verify", () => {
  it("requires a token", async () => {
    const { status, data } = await requestJson("/auth/verify");
    expect(status).toBe(400);
    expect(data.error).toBe("Token required");
  });

  it("rejects an unknown token", async () => {
    const { status, data } = await requestJson("/auth/verify?token=nope");
    expect(status).toBe(401);
    expect(data.error).toBe("Invalid or expired token");
  });

  it("exchanges a magic token for a session cookie", async () => {
    const user = await createUser({
      email: "magic@example.com",
      username: "magic",
    });
    await env.SESSIONS.put(
      "magic:tok123",
      JSON.stringify({ email: user.email, username: user.username }),
    );

    const res = await request("/auth/verify?token=tok123");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.user.username).toBe("magic");
    expect(data.user.isAdmin).toBe(false);

    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toContain("session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("consumes the magic token so it cannot be reused", async () => {
    const user = await createUser({
      email: "once@example.com",
      username: "once",
    });
    await env.SESSIONS.put(
      "magic:single",
      JSON.stringify({ email: user.email, username: user.username }),
    );
    const first = await requestJson("/auth/verify?token=single");
    expect(first.status).toBe(200);
    const second = await requestJson("/auth/verify?token=single");
    expect(second.status).toBe(401);
  });

  it("404s when the token is valid but the user is gone", async () => {
    await env.SESSIONS.put(
      "magic:ghost",
      JSON.stringify({ email: "ghost@example.com", username: "ghost" }),
    );
    const { status, data } = await requestJson("/auth/verify?token=ghost");
    expect(status).toBe(404);
    expect(data.error).toBe("User not found");
  });
});

describe("GET /auth/me", () => {
  it("401s without a session", async () => {
    const { status } = await requestJson("/auth/me");
    expect(status).toBe(401);
  });

  it("401s with an unknown session token", async () => {
    const { status } = await requestJson("/auth/me", { token: "bogus" });
    expect(status).toBe(401);
  });

  it("returns the user and isAdmin=false for a normal user", async () => {
    const { token } = await createUserWithSession({
      email: "plain@example.com",
      username: "plain",
    });
    const { status, data } = await requestJson("/auth/me", { token });
    expect(status).toBe(200);
    expect(data.user.username).toBe("plain");
    expect(data.user.isAdmin).toBe(false);
  });

  it("returns isAdmin=true for an ADMIN_EMAILS user", async () => {
    const { token } = await createUserWithSession({
      email: ADMIN_EMAIL,
      username: "boss",
    });
    const { data } = await requestJson("/auth/me", { token });
    expect(data.user.isAdmin).toBe(true);
  });
});

// The settings page renders user.email straight from AuthContext, which is
// seeded by /auth/verify on a fresh login and by /auth/me on every later load.
// When the two shapes drifted, email was missing until the user reloaded — the
// field showed blank for exactly the people who had just signed in.
describe("/auth/verify and /auth/me agree on the user shape", () => {
  it("returns identical fields from both endpoints", async () => {
    const user = await createUser({
      email: "shape@example.com",
      username: "shape",
    });
    await env.SESSIONS.put(
      "magic:shapetok",
      JSON.stringify({ email: user.email, username: user.username }),
    );

    const verified = await requestJson("/auth/verify?token=shapetok");
    const { token } = await createUserWithSession({
      email: "shape2@example.com",
      username: "shape2",
    });
    const fetched = await requestJson("/auth/me", { token });

    expect(Object.keys(verified.data.user).sort()).toEqual(
      Object.keys(fetched.data.user).sort(),
    );
  });

  it("includes the email on a fresh login, not just on reload", async () => {
    const user = await createUser({
      email: "fresh@example.com",
      username: "fresh",
    });
    await env.SESSIONS.put(
      "magic:freshtok",
      JSON.stringify({ email: user.email, username: user.username }),
    );

    const { data } = await requestJson("/auth/verify?token=freshtok");
    expect(data.user.email).toBe("fresh@example.com");
    expect(data.user.username).toBe("fresh");
    expect(data.user.id).toBe(user.id);
  });
});

describe("POST /auth/logout", () => {
  it("clears the cookie and deletes the KV session", async () => {
    const { token } = await createUserWithSession({
      email: "bye@example.com",
      username: "bye",
    });
    const res = await request("/auth/logout", { method: "POST", token });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(await env.SESSIONS.get(token)).toBeNull();
  });

  it("succeeds even without a session", async () => {
    const res = await request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("GET /auth/github", () => {
  it("redirects to GitHub and stores oauth state", async () => {
    const res = await request("/auth/github");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain(
      "https://github.com/login/oauth/authorize",
    );
    const keys = await env.SESSIONS.list({ prefix: "oauth_state:" });
    expect(keys.keys.length).toBe(1);
  });
});

describe("routing", () => {
  it("404s an unknown path", async () => {
    const { status, data } = await requestJson("/api/does-not-exist");
    expect(status).toBe(404);
    expect(data.error).toBe("Not found");
  });
});
