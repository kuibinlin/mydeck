// Upstream failures, classified.
//
// The only thing the two loops above these providers can act on is `.status`:
// generateStructured rethrows a status-carrying error and retries everything
// else, and agentLoop now does the same. So whether a failure is retried comes
// down entirely to the string matching below — which is why it is tested rather
// than trusted.
//
// The case that motivated this: Workers AI answers a spent daily allowance with
//
//   4006: you have used up your daily free allocation of 10,000 neurons, ...
//
// as a plain Error with no status. Untranslated it was retried three times and
// then reported to the user as "AI returned invalid output after 3 attempts.
// Please try again." — which blames their article for an account ceiling and
// sends them to retry something that cannot succeed until the day rolls over.

import { describe, it, expect } from "vitest";
import { translate } from "../src/ai/providers/cloudflare.js";

const NEURONS =
  "4006: you have used up your daily free allocation of 10,000 neurons, " +
  "please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.";

describe("a spent daily allowance", () => {
  it("is a 429, so nothing upstream retries it", () => {
    const out = translate(new Error(NEURONS), "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(out.status).toBe(429);
  });

  it("says what happened and what still works", () => {
    const out = translate(new Error(NEURONS), "m");
    expect(out.message).toMatch(/allowance for today is used up/i);
    expect(out.message).toMatch(/lookups and your decks still work/i);
    // Never the old message: it named the wrong cause and asked for a retry.
    expect(out.message).not.toMatch(/invalid output/i);
  });

  it("matches on the code and on the prose independently", () => {
    // Cloudflare has reworded this before; either half is enough to classify.
    expect(translate(new Error("4006: something new"), "m").status).toBe(429);
    expect(
      translate(new Error("You are out of neurons for today"), "m").status,
    ).toBe(429);
    expect(
      translate(new Error("daily free allocation exhausted"), "m").status,
    ).toBe(429);
  });

  it("reads a thrown non-Error too", () => {
    expect(translate(NEURONS, "m").status).toBe(429);
  });
});

describe("a model that does not exist", () => {
  it("is not retried, and names the model so the config is findable", () => {
    const out = translate(new Error("No such model: @cf/typo/bad"), "@cf/typo/bad");
    expect(out.status).toBe(502);
    expect(out.message).toContain("@cf/typo/bad");
  });

  it("covers the wordings the binding actually uses", () => {
    for (const text of [
      "no such model",
      "Model not found",
      "invalid model name",
      "5007: unknown",
    ]) {
      expect(translate(new Error(text), "m").status).toBe(502);
    }
  });
});

describe("anything else", () => {
  // The retry is worth having for real transient faults, so an unrecognised
  // error must stay status-less or it loses its one retry.
  it("stays status-less so the retry above still applies", () => {
    const out = translate(new Error("connection reset"), "m");
    expect(out.status).toBeUndefined();
    expect(out.message).toBe("connection reset");
  });

  it("preserves the original error object", () => {
    const original = new Error("boom");
    expect(translate(original, "m")).toBe(original);
  });

  it("wraps a thrown string into an Error", () => {
    const out = translate("plain string failure", "m");
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe("plain string failure");
  });
});
