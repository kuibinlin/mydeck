import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  requestJson,
  createUserWithSession,
  createFlashcardDeck,
  publishFlashcardDeck,
  ADMIN_EMAIL,
} from "./helpers";

const owner = () =>
  createUserWithSession({ email: "owner@example.com", username: "owner" });
const stranger = () =>
  createUserWithSession({ email: "other@example.com", username: "other" });

describe("GET /api/flashcard-decks", () => {
  it("is public and lists published decks with author and card count", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token, { title: "Kanji" });
    await publishFlashcardDeck(token, deckId, 3);

    const { status, data } = await requestJson("/api/flashcard-decks");
    expect(status).toBe(200);
    expect(data.decks).toHaveLength(1);
    expect(data.decks[0].title).toBe("Kanji");
    expect(data.decks[0].author).toBe("owner");
    expect(data.decks[0].card_count).toBe(3);
  });
});

describe("POST /api/flashcard-decks", () => {
  it("401s without a session", async () => {
    const { status } = await requestJson("/api/flashcard-decks", {
      method: "POST",
      body: { title: "x", category: "Language" },
    });
    expect(status).toBe(401);
  });

  it("requires title and category", async () => {
    const { token } = await owner();
    const noTitle = await requestJson("/api/flashcard-decks", {
      method: "POST",
      token,
      body: { category: "Language" },
    });
    expect(noTitle.status).toBe(400);

    const noCategory = await requestJson("/api/flashcard-decks", {
      method: "POST",
      token,
      body: { title: "x" },
    });
    expect(noCategory.status).toBe(400);
  });

  it("rejects an over-long title or description", async () => {
    const { token } = await owner();
    const longTitle = await requestJson("/api/flashcard-decks", {
      method: "POST",
      token,
      body: { title: "a".repeat(201), category: "Language" },
    });
    expect(longTitle.status).toBe(400);
    expect(longTitle.data.error).toContain("Title too long");

    const longDesc = await requestJson("/api/flashcard-decks", {
      method: "POST",
      token,
      body: { title: "ok", category: "Language", description: "d".repeat(501) },
    });
    expect(longDesc.status).toBe(400);
    expect(longDesc.data.error).toContain("Description too long");
  });

  it("creates a deck and returns its id", async () => {
    const { token } = await owner();
    const { status, data } = await requestJson("/api/flashcard-decks", {
      method: "POST",
      token,
      body: { title: "New", category: "Language", description: "d" },
    });
    expect(status).toBe(201);
    expect(data.ok).toBe(true);
    expect(typeof data.id).toBe("number");
  });
});

describe("GET /api/flashcard-decks/:id", () => {
  it("returns the deck, its cards and linked challenges", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
      method: "POST",
      token,
      body: { front: "f", meaning: "m", note: "n" },
    });

    const { status, data } = await requestJson(`/api/flashcard-decks/${deckId}`, { token });
    expect(status).toBe(200);
    expect(data.deck.id).toBe(deckId);
    expect(data.deck.author).toBe("owner");
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0].front).toBe("f");
    expect(data.linked_challenges).toEqual([]);
  });

  it("404s for a missing deck", async () => {
    const { status } = await requestJson("/api/flashcard-decks/9999");
    expect(status).toBe(404);
  });

  it("omits soft-deleted cards", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { data: created } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "f", meaning: "m" } },
    );
    await requestJson(`/api/flashcards/${created.id}`, {
      method: "DELETE",
      token,
    });

    const { data } = await requestJson(`/api/flashcard-decks/${deckId}`, { token });
    expect(data.cards).toHaveLength(0);
  });
});

describe("PUT /api/flashcard-decks/:id", () => {
  it("lets the owner update it", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { status } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      method: "PUT",
      token,
      body: { title: "Renamed" },
    });
    expect(status).toBe(200);

    const { data } = await requestJson(`/api/flashcard-decks/${deckId}`, { token });
    expect(data.deck.title).toBe("Renamed");
  });

  it("403s for a non-owner", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { token: otherToken } = await stranger();
    const { status, data } = await requestJson(
      `/api/flashcard-decks/${deckId}`,
      { method: "PUT", token: otherToken, body: { title: "Hijack" } },
    );
    expect(status).toBe(403);
    expect(data.error).toBe("Not your deck");
  });

  it("404s when the deck does not exist", async () => {
    const { token } = await owner();
    const { status } = await requestJson("/api/flashcard-decks/4242", {
      method: "PUT",
      token,
      body: { title: "x" },
    });
    expect(status).toBe(404);
  });

  it("lets an admin update someone else's deck", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { token: adminToken } = await createUserWithSession({
      email: ADMIN_EMAIL,
      username: "boss",
    });
    const { status } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      method: "PUT",
      token: adminToken,
      body: { title: "Moderated" },
    });
    expect(status).toBe(200);
  });
});

describe("DELETE /api/flashcard-decks/:id", () => {
  it("removes the deck and its cards", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
      method: "POST",
      token,
      body: { front: "f", meaning: "m" },
    });

    const { status } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      method: "DELETE",
      token,
    });
    expect(status).toBe(200);

    const { n } = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM flashcards WHERE deck_id = ?",
    )
      .bind(deckId)
      .first();
    expect(n).toBe(0);

    const after = await requestJson(`/api/flashcard-decks/${deckId}`, { token });
    expect(after.status).toBe(404);
  });

  it("403s for a non-owner", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { token: otherToken } = await stranger();
    const { status } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      method: "DELETE",
      token: otherToken,
    });
    expect(status).toBe(403);
  });
});

describe("POST /api/flashcard-decks/:id/cards", () => {
  it("401s without a session and 403s for a non-owner", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);

    const anon = await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
      method: "POST",
      body: { front: "f", meaning: "m" },
    });
    expect(anon.status).toBe(401);

    const { token: otherToken } = await stranger();
    const other = await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
      method: "POST",
      token: otherToken,
      body: { front: "f", meaning: "m" },
    });
    expect(other.status).toBe(403);
  });

  it("requires front and meaning", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { status, data } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "f" } },
    );
    expect(status).toBe(400);
    expect(data.error).toBe("Front and meaning required");
  });

  it("enforces field length limits", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);

    const longFront = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "f".repeat(501), meaning: "m" } },
    );
    expect(longFront.status).toBe(400);

    const longMeaning = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "f", meaning: "m".repeat(2001) } },
    );
    expect(longMeaning.status).toBe(400);

    const longNote = await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
      method: "POST",
      token,
      body: { front: "f", meaning: "m", note: "n".repeat(2001) },
    });
    expect(longNote.status).toBe(400);
  });

  it("enforces MAX_CARDS_PER_DECK", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);

    const limit = parseInt(env.MAX_CARDS_PER_DECK, 10);
    for (let i = 0; i < limit; i++) {
      await env.DB.prepare(
        "INSERT INTO flashcards (deck_id, front, meaning) VALUES (?, ?, ?)",
      )
        .bind(deckId, `f${i}`, `m${i}`)
        .run();
    }

    const { status, data } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "one", meaning: "too many" } },
    );
    expect(status).toBe(400);
    expect(data.error).toContain(`${limit}-card limit`);
  });
});

describe("/api/flashcards/:id", () => {
  it("404s for a missing card", async () => {
    const { token } = await owner();
    const { status } = await requestJson("/api/flashcards/9999", {
      method: "PUT",
      token,
      body: { front: "x" },
    });
    expect(status).toBe(404);
  });

  it("403s when the card belongs to someone else", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { data: card } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "f", meaning: "m" } },
    );

    const { token: otherToken } = await stranger();
    const { status } = await requestJson(`/api/flashcards/${card.id}`, {
      method: "PUT",
      token: otherToken,
      body: { front: "hijack" },
    });
    expect(status).toBe(403);
  });

  it("updates a card", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { data: card } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "f", meaning: "m", note: "n" } },
    );

    const { status } = await requestJson(`/api/flashcards/${card.id}`, {
      method: "PUT",
      token,
      body: { front: "updated", meaning: "m2", note: "n2" },
    });
    expect(status).toBe(200);

    const { data } = await requestJson(`/api/flashcard-decks/${deckId}`, { token });
    expect(data.cards[0].front).toBe("updated");
    expect(data.cards[0].meaning).toBe("m2");
    expect(data.cards[0].note).toBe("n2");
  });

  it("soft-deletes a card", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { data: card } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "f", meaning: "m" } },
    );

    const { status } = await requestJson(`/api/flashcards/${card.id}`, {
      method: "DELETE",
      token,
    });
    expect(status).toBe(200);

    const row = await env.DB.prepare(
      "SELECT is_deleted FROM flashcards WHERE id = ?",
    )
      .bind(card.id)
      .first();
    expect(row.is_deleted).toBe(1);
  });
});
