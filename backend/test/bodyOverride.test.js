// The request body must never be able to supply server-derived arguments.
//
// An earlier version of the route layer built service arguments as
// `{ user, ...(await request.json()) }`. The body spread last, so a request
// carrying {"user": {...}} replaced the authenticated user — any logged-in
// account could edit or delete any deck, or claim admin by naming an admin
// email. These tests pin the ordering shut.

import { describe, it, expect } from "vitest";
import { env, SELF } from "cloudflare:test";
import {
  requestJson,
  createUserWithSession,
  createFlashcardDeck,
  createChallengeDeck,
  publishChallenge,
  ADMIN_EMAIL,
} from "./helpers";

async function victimAndAttacker() {
  const { token: ownerToken, user: owner } = await createUserWithSession({
    email: "owner@example.com",
    username: "owner",
  });
  const { token: attackerToken, user: attacker } = await createUserWithSession({
    email: "mallory@example.com",
    username: "mallory",
  });
  return { ownerToken, owner, attackerToken, attacker };
}

describe("request body cannot override the authenticated user", () => {
  it("refuses a flashcard deck update that impersonates the owner by id", async () => {
    const { ownerToken, owner, attackerToken } = await victimAndAttacker();
    const deckId = await createFlashcardDeck(ownerToken, { title: "Private" });

    const { status } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      method: "PUT",
      token: attackerToken,
      body: { title: "PWNED", user: { id: owner.id } },
    });

    expect(status).toBe(403);
    const row = await env.DB.prepare(
      "SELECT title FROM flashcard_decks WHERE id = ?",
    )
      .bind(deckId)
      .first();
    expect(row.title).toBe("Private");
  });

  it("refuses a flashcard deck update that claims an admin email", async () => {
    const { ownerToken, attackerToken } = await victimAndAttacker();
    const deckId = await createFlashcardDeck(ownerToken, { title: "Private" });

    const { status } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      method: "PUT",
      token: attackerToken,
      body: { title: "PWNED", user: { id: 99999, email: ADMIN_EMAIL } },
    });

    expect(status).toBe(403);
  });

  it("refuses a challenge deck update that impersonates the owner", async () => {
    const { ownerToken, owner, attackerToken } = await victimAndAttacker();
    const deckId = await createChallengeDeck(ownerToken, { title: "Quiz" });

    const { status } = await requestJson(`/api/challenge-decks/${deckId}`, {
      method: "PUT",
      token: attackerToken,
      body: { title: "PWNED", user: { id: owner.id } },
    });

    expect(status).toBe(403);
  });

  it("refuses adding a card to someone else's deck", async () => {
    const { ownerToken, owner, attackerToken } = await victimAndAttacker();
    const deckId = await createFlashcardDeck(ownerToken);

    const { status } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      {
        method: "POST",
        token: attackerToken,
        body: { front: "f", meaning: "m", user: { id: owner.id } },
      },
    );

    expect(status).toBe(403);
  });

  it("attributes a new deck to the session user, not the body", async () => {
    const { owner, attackerToken, attacker } = await victimAndAttacker();

    const { data } = await requestJson("/api/flashcard-decks", {
      method: "POST",
      token: attackerToken,
      body: { title: "D", category: "Language", user: { id: owner.id } },
    });

    const row = await env.DB.prepare(
      "SELECT created_by FROM flashcard_decks WHERE id = ?",
    )
      .bind(data.id)
      .first();
    expect(row.created_by).toBe(attacker.id);
  });

  it("records a score against the session user, not the body", async () => {
    const { ownerToken, owner, attackerToken, attacker } =
      await victimAndAttacker();
    const chId = await createChallengeDeck(ownerToken);
    const { versionId, cardCount } = await publishChallenge(
      ownerToken,
      chId,
      3,
    );

    const { status } = await requestJson("/api/scores", {
      method: "POST",
      token: attackerToken,
      body: {
        challenge_version_id: versionId,
        score: 0,
        total: cardCount,
        user: { id: owner.id },
      },
    });

    expect(status).toBe(201);
    const rows = await env.DB.prepare(
      "SELECT user_id FROM scores WHERE challenge_version_id = ?",
    )
      .bind(versionId)
      .all();
    expect(rows.results.map((r) => r.user_id)).toEqual([attacker.id]);
  });

  it("credits a deck link to the session user, not the body", async () => {
    const { ownerToken, owner, attackerToken, attacker } =
      await victimAndAttacker();
    const fcId = await createFlashcardDeck(ownerToken);
    const chId = await createChallengeDeck(ownerToken);

    await requestJson("/api/deck-links", {
      method: "POST",
      token: attackerToken,
      body: {
        flashcard_deck_id: fcId,
        challenge_deck_id: chId,
        user: { id: owner.id },
      },
    });

    const row = await env.DB.prepare(
      "SELECT created_by FROM deck_links WHERE flashcard_deck_id = ? AND challenge_deck_id = ?",
    )
      .bind(fcId, chId)
      .first();
    expect(row.created_by).toBe(attacker.id);
  });

  it("ignores a body-supplied cardId path param", async () => {
    const { ownerToken, attackerToken } = await victimAndAttacker();
    const deckId = await createFlashcardDeck(ownerToken);
    const { data: card } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token: ownerToken, body: { front: "f", meaning: "m" } },
    );

    const attackerDeck = await createFlashcardDeck(attackerToken, {
      title: "Mine",
    });
    const { data: ownCard } = await requestJson(
      `/api/flashcard-decks/${attackerDeck}/cards`,
      { method: "POST", token: attackerToken, body: { front: "a", meaning: "b" } },
    );

    // Attacker edits their own card but names the victim's card in the body.
    await requestJson(`/api/flashcards/${ownCard.id}`, {
      method: "PUT",
      token: attackerToken,
      body: { front: "hijacked", cardId: card.id },
    });

    const victimCard = await env.DB.prepare(
      "SELECT front FROM flashcards WHERE id = ?",
    )
      .bind(card.id)
      .first();
    expect(victimCard.front).toBe("f");
  });
});

describe("malformed bodies", () => {
  it("400s an unparseable body instead of crashing as a 500", async () => {
    const { token } = await createUserWithSession({
      email: "o@example.com",
      username: "o",
    });
    const res = await SELF.fetch("http://localhost:8787/api/flashcard-decks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("400s a JSON body that is not an object", async () => {
    const { token } = await createUserWithSession({
      email: "o@example.com",
      username: "o",
    });
    const { status } = await requestJson("/api/flashcard-decks", {
      method: "POST",
      token,
      body: ["not", "an", "object"],
    });
    expect(status).toBe(400);
  });
});
