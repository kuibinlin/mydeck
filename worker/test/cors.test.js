import { describe, it, expect } from "vitest";
import { request } from "./helpers";

describe("CORS", () => {
  it("answers preflight with 204 and the CORS headers", async () => {
    const res = await request("/api/flashcard-decks", {
      method: "OPTIONS",
      origin: "http://localhost:5173",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("reflects a localhost origin when the worker itself is on localhost", async () => {
    const res = await request("/api/flashcard-decks", {
      origin: "http://localhost:5173",
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
  });

  it("reflects any localhost port, not just 5173", async () => {
    const res = await request("/api/flashcard-decks", {
      origin: "http://localhost:5199",
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5199",
    );
  });

  it("reflects a production origin", async () => {
    const res = await request("/api/flashcard-decks", {
      origin: "https://mydeck.linsnotes.com",
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://mydeck.linsnotes.com",
    );
  });

  it("does not reflect an unknown origin", async () => {
    const res = await request("/api/flashcard-decks", {
      origin: "https://evil.example.com",
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("sets nosniff on JSON responses", async () => {
    const res = await request("/api/flashcard-decks");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
