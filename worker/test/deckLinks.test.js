import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  requestJson,
  createUserWithSession,
  createChallengeDeck,
  createFlashcardDeck,
} from "./helpers";

const owner = () =>
  createUserWithSession({ email: "owner@example.com", username: "owner" });

async function linkedPair() {
  const { token } = await owner();
  const fcId = await createFlashcardDeck(token, { title: "Vocab" });
  const chId = await createChallengeDeck(token, { title: "Quiz" });
  return { token, fcId, chId };
}

describe("POST /api/deck-links", () => {
  it("401s without a session", async () => {
    const { status } = await requestJson("/api/deck-links", {
      method: "POST",
      body: { flashcard_deck_id: 1, challenge_deck_id: 1 },
    });
    expect(status).toBe(401);
  });

  it("requires both deck ids", async () => {
    const { token } = await owner();
    const { status, data } = await requestJson("/api/deck-links", {
      method: "POST",
      token,
      body: { flashcard_deck_id: 1 },
    });
    expect(status).toBe(400);
    expect(data.error).toBe("Both deck IDs required");
  });

  it("creates a link", async () => {
    const { token, fcId, chId } = await linkedPair();
    const { status } = await requestJson("/api/deck-links", {
      method: "POST",
      token,
      body: { flashcard_deck_id: fcId, challenge_deck_id: chId },
    });
    expect(status).toBe(201);

    const { n } = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM deck_links WHERE flashcard_deck_id = ? AND challenge_deck_id = ?",
    )
      .bind(fcId, chId)
      .first();
    expect(n).toBe(1);
  });

  it("is idempotent", async () => {
    const { token, fcId, chId } = await linkedPair();
    const body = { flashcard_deck_id: fcId, challenge_deck_id: chId };
    await requestJson("/api/deck-links", { method: "POST", token, body });
    await requestJson("/api/deck-links", { method: "POST", token, body });

    const { n } = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM deck_links",
    ).first();
    expect(n).toBe(1);
  });
});

describe("GET /api/deck-links", () => {
  it("looks up challenges by flashcard deck", async () => {
    const { token, fcId, chId } = await linkedPair();
    await requestJson("/api/deck-links", {
      method: "POST",
      token,
      body: { flashcard_deck_id: fcId, challenge_deck_id: chId },
    });

    const { status, data } = await requestJson(
      `/api/deck-links?flashcard_deck_id=${fcId}`,
    );
    expect(status).toBe(200);
    expect(data.links).toHaveLength(1);
    expect(data.links[0].challenge_deck_id).toBe(chId);
    expect(data.links[0].title).toBe("Quiz");
  });

  it("looks up flashcard decks by challenge", async () => {
    const { token, fcId, chId } = await linkedPair();
    await requestJson("/api/deck-links", {
      method: "POST",
      token,
      body: { flashcard_deck_id: fcId, challenge_deck_id: chId },
    });

    const { data } = await requestJson(
      `/api/deck-links?challenge_deck_id=${chId}`,
    );
    expect(data.links).toHaveLength(1);
    expect(data.links[0].flashcard_deck_id).toBe(fcId);
    expect(data.links[0].title).toBe("Vocab");
  });

  it("400s when neither id is given", async () => {
    const { status, data } = await requestJson("/api/deck-links");
    expect(status).toBe(400);
    expect(data.error).toContain("Provide flashcard_deck_id or challenge_deck_id");
  });
});

describe("DELETE /api/deck-links/:id", () => {
  it("removes a link the caller created", async () => {
    const { token, fcId, chId } = await linkedPair();
    await requestJson("/api/deck-links", {
      method: "POST",
      token,
      body: { flashcard_deck_id: fcId, challenge_deck_id: chId },
    });
    const link = await env.DB.prepare("SELECT id FROM deck_links").first();

    const { status } = await requestJson(`/api/deck-links/${link.id}`, {
      method: "DELETE",
      token,
    });
    expect(status).toBe(200);

    const { n } = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM deck_links",
    ).first();
    expect(n).toBe(0);
  });

  it("does not remove a link created by someone else", async () => {
    const { token, fcId, chId } = await linkedPair();
    await requestJson("/api/deck-links", {
      method: "POST",
      token,
      body: { flashcard_deck_id: fcId, challenge_deck_id: chId },
    });
    const link = await env.DB.prepare("SELECT id FROM deck_links").first();

    const { token: otherToken } = await createUserWithSession({
      email: "other@example.com",
      username: "other",
    });
    await requestJson(`/api/deck-links/${link.id}`, {
      method: "DELETE",
      token: otherToken,
    });

    const { n } = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM deck_links",
    ).first();
    expect(n).toBe(1);
  });
});
