import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { requestJson, createUserWithSession, ADMIN_EMAIL } from "./helpers";

// These tests deliberately never reach the model. Every case asserts a path
// that returns before callAI — validation, auth, or the rate limiter — so the
// suite stays offline and free. See test/wrangler.test.toml (no [ai] binding).

const user = () =>
  createUserWithSession({ email: "user@example.com", username: "user" });

async function logUsage(userId, times, endpoint = "generate-flashcards") {
  for (let i = 0; i < times; i++) {
    await env.DB.prepare(
      "INSERT INTO ai_usage_log (user_id, endpoint, plan) VALUES (?, ?, ?)",
    )
      .bind(String(userId), endpoint, "free")
      .run();
  }
}

describe("GET /api/ai/settings", () => {
  it("401s without a session", async () => {
    const { status } = await requestJson("/api/ai/settings");
    expect(status).toBe(401);
  });

  it("returns the free daily limit for a normal user", async () => {
    const { token } = await user();
    const { status, data } = await requestJson("/api/ai/settings", { token });
    expect(status).toBe(200);
    expect(data.usage.used).toBe(0);
    expect(data.usage.limit).toBe(parseInt(env.AI_DAILY_LIMIT_FREE, 10));
  });

  it("counts today's usage", async () => {
    const { user: u, token } = await user();
    await logUsage(u.id, 2);
    const { data } = await requestJson("/api/ai/settings", { token });
    expect(data.usage.used).toBe(2);
  });

  it("reports no limit for an admin", async () => {
    const { token } = await createUserWithSession({
      email: ADMIN_EMAIL,
      username: "boss",
    });
    const { data } = await requestJson("/api/ai/settings", { token });
    expect(data.usage.limit).toBeNull();
  });
});

describe("POST /api/ai/generate-flashcards", () => {
  const post = (token, body) =>
    requestJson("/api/ai/generate-flashcards", { method: "POST", token, body });

  it("401s without a session", async () => {
    const { status } = await requestJson("/api/ai/generate-flashcards", {
      method: "POST",
      body: { article: "text", count: 5 },
    });
    expect(status).toBe(401);
  });

  it("requires article text", async () => {
    const { token } = await user();
    const { status, data } = await post(token, { count: 5 });
    expect(status).toBe(400);
    expect(data.error).toBe("Article text is required");
  });

  it("rejects an article over 10,000 characters", async () => {
    const { token } = await user();
    const { status, data } = await post(token, {
      article: "a".repeat(10001),
      count: 5,
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Article too long");
  });

  it("rejects a count outside 1-30", async () => {
    const { token } = await user();
    for (const count of [0, 31, "abc"]) {
      const { status, data } = await post(token, { article: "text", count });
      expect(status).toBe(400);
      expect(data.error).toBe("Count must be between 1 and 30");
    }
  });

  it("429s once the daily limit is reached", async () => {
    const { user: u, token } = await user();
    await logUsage(u.id, parseInt(env.AI_DAILY_LIMIT_FREE, 10));

    const { status, data } = await post(token, { article: "text", count: 5 });
    expect(status).toBe(429);
    expect(data.error).toContain("Daily AI generation limit reached");
  });
});

describe("POST /api/ai/generate-vocab", () => {
  const post = (token, body) =>
    requestJson("/api/ai/generate-vocab", { method: "POST", token, body });

  it("401s without a session", async () => {
    const { status } = await requestJson("/api/ai/generate-vocab", {
      method: "POST",
      body: { article: "text", count: 5 },
    });
    expect(status).toBe(401);
  });

  it("checks the count before anything else", async () => {
    const { token } = await user();
    const { status, data } = await post(token, { count: 0 });
    expect(status).toBe(400);
    expect(data.error).toBe("Count must be between 1 and 30");
  });

  it("requires either cards or an article", async () => {
    const { token } = await user();
    const { status, data } = await post(token, { count: 5 });
    expect(status).toBe(400);
    expect(data.error).toBe("Provide either cards or article");
  });

  it("rejects more than 50 cards", async () => {
    const { token } = await user();
    const cards = Array.from({ length: 51 }, (_, i) => ({
      front: `f${i}`,
      meaning: `m${i}`,
    }));
    const { status, data } = await post(token, { cards, count: 5 });
    expect(status).toBe(400);
    expect(data.error).toContain("at most 50");
  });

  it("rejects a non-array cards value", async () => {
    const { token } = await user();
    const { status } = await post(token, { cards: "nope", count: 5 });
    expect(status).toBe(400);
  });

  it("rejects an over-long article", async () => {
    const { token } = await user();
    const { status, data } = await post(token, {
      article: "a".repeat(10001),
      count: 5,
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Article too long");
  });

  it("429s once the daily limit is reached", async () => {
    const { user: u, token } = await user();
    await logUsage(u.id, parseInt(env.AI_DAILY_LIMIT_FREE, 10));
    const { status } = await post(token, { article: "text", count: 5 });
    expect(status).toBe(429);
  });
});

describe("POST /api/ai/generate-comprehension", () => {
  const post = (token, body) =>
    requestJson("/api/ai/generate-comprehension", {
      method: "POST",
      token,
      body,
    });

  it("401s without a session", async () => {
    const { status } = await requestJson("/api/ai/generate-comprehension", {
      method: "POST",
      body: { article: "text", count: 5 },
    });
    expect(status).toBe(401);
  });

  it("requires article text", async () => {
    const { token } = await user();
    const { status, data } = await post(token, { count: 5 });
    expect(status).toBe(400);
    expect(data.error).toBe("Article text is required");
  });

  it("rejects a bad count", async () => {
    const { token } = await user();
    const { status, data } = await post(token, { article: "text", count: 99 });
    expect(status).toBe(400);
    expect(data.error).toBe("Count must be between 1 and 30");
  });

  it("429s once the daily limit is reached", async () => {
    const { user: u, token } = await user();
    await logUsage(u.id, parseInt(env.AI_DAILY_LIMIT_FREE, 10));
    const { status } = await post(token, { article: "text", count: 5 });
    expect(status).toBe(429);
  });
});
