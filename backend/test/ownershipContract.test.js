// The edit pages decide whether to render a form or an "access denied" view
// from `deck.created_by` and `user.isAdmin`. Both must survive the trip to the
// client, or the UI silently falls back to showing an editable form whose every
// write 403s.

import { describe, it, expect } from "vitest";
import {
  requestJson,
  createUserWithSession,
  createFlashcardDeck,
  createChallengeDeck,
  publishFlashcardDeck,
  ADMIN_EMAIL,
} from "./helpers";

describe("deck payloads expose the owner", () => {
  it("includes created_by on a flashcard deck", async () => {
    const { token, user } = await createUserWithSession({
      email: "owner@example.com",
      username: "owner",
    });
    const deckId = await createFlashcardDeck(token);

    const { data } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      token,
    });
    expect(data.deck.created_by).toBe(user.id);
  });

  it("includes created_by on a challenge deck", async () => {
    const { token, user } = await createUserWithSession({
      email: "owner@example.com",
      username: "owner",
    });
    const deckId = await createChallengeDeck(token);

    const { data } = await requestJson(`/api/challenge-decks/${deckId}`, {
      token,
    });
    expect(data.deck.created_by).toBe(user.id);
  });

  it("lets a non-owner read a published deck, so the UI can show it read-only", async () => {
    const { token: ownerToken, user: owner } = await createUserWithSession({
      email: "owner@example.com",
      username: "owner",
    });
    const deckId = await createFlashcardDeck(ownerToken);
    await publishFlashcardDeck(ownerToken, deckId, 3);

    const { token: otherToken } = await createUserWithSession({
      email: "other@example.com",
      username: "other",
    });

    const { status, data } = await requestJson(
      `/api/flashcard-decks/${deckId}`,
      { token: otherToken },
    );
    // Once published, reads are open to everyone — only writes stay owner-gated,
    // which is exactly why the edit page needs its own check on top.
    expect(status).toBe(200);
    expect(data.deck.created_by).toBe(owner.id);
  });

  it("404s a draft for a non-owner, so 'only you can see this' holds", async () => {
    const { token: ownerToken } = await createUserWithSession({
      email: "owner@example.com",
      username: "owner",
    });
    const deckId = await createFlashcardDeck(ownerToken);

    const { token: otherToken } = await createUserWithSession({
      email: "other@example.com",
      username: "other",
    });

    // 404 rather than 403: a draft should not confirm it exists. Without this,
    // hiding drafts from the list would be cosmetic — anyone could read one by
    // guessing its id.
    const { status } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      token: otherToken,
    });
    expect(status).toBe(404);

    const anon = await requestJson(`/api/flashcard-decks/${deckId}`);
    expect(anon.status).toBe(404);
  });
});

describe("isAdmin reaches the client", () => {
  it("is false for a normal user on /auth/me", async () => {
    const { token } = await createUserWithSession({
      email: "plain@example.com",
      username: "plain",
    });
    const { data } = await requestJson("/auth/me", { token });
    expect(data.user.isAdmin).toBe(false);
  });

  it("is true for an admin on /auth/me", async () => {
    const { token } = await createUserWithSession({
      email: ADMIN_EMAIL,
      username: "boss",
    });
    const { data } = await requestJson("/auth/me", { token });
    expect(data.user.isAdmin).toBe(true);
  });
});
