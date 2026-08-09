// /health and /version.
//
// These are the endpoints CI will smoke-test after a deploy, so the properties
// that matter are the ones a deploy can break: they must answer without a
// session, without a database, and they must not become the one route that
// forgets CORS.

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { request, requestJson } from "./helpers";

describe("GET /health", () => {
  it("returns 200 {status:'ok'} with no session", async () => {
    const { res, data } = await requestJson("/health");
    expect(res.status).toBe(200);
    expect(data).toEqual({ status: "ok" });
  });

  it("carries CORS headers like every other route", async () => {
    const res = await request("/health", {
      origin: "https://mydeck.linsnotes.com",
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://mydeck.linsnotes.com",
    );
  });

  // The whole point of a health check is that it is cheap enough to poll. If it
  // ever starts reading D1, an uptime monitor becomes unbounded read load and an
  // unauthenticated caller gains a way to make the worker do work. Asserting on
  // the response alone cannot catch that, so this drops the binding entirely and
  // requires the route to still answer.
  it("does not touch the database", async () => {
    const realDB = env.DB;
    env.DB = undefined;
    try {
      const { res, data } = await requestJson("/health");
      expect(res.status).toBe(200);
      expect(data).toEqual({ status: "ok" });
    } finally {
      env.DB = realDB;
    }
  });
});

describe("GET /version", () => {
  // APP_VERSION is deliberately absent from wrangler.test.toml — unset is the
  // local-dev case, and reporting "development" is what makes a smoke test able
  // to tell a real deploy from someone's laptop.
  it("reports 'development' when APP_VERSION is unset", async () => {
    const { res, data } = await requestJson("/version");
    expect(res.status).toBe(200);
    expect(data.version).toBe("development");
    expect(data.environment).toBe("development");
  });

  it("reports the injected version when APP_VERSION is set at deploy time", async () => {
    env.APP_VERSION = "abc1234";
    try {
      const { data } = await requestJson("/version");
      expect(data.version).toBe("abc1234");
      expect(data.environment).toBe("production");
    } finally {
      delete env.APP_VERSION;
    }
  });
});
