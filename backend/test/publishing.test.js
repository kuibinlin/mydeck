// Draft/publish behaves identically for both deck types — that consistency is
// the entire point of the feature, so it is asserted side by side rather than
// in two separate files that could drift apart.

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  requestJson,
  createUserWithSession,
  createFlashcardDeck,
  createChallengeDeck,
  publishFlashcardDeck,
  publishChallenge,
  sampleQuestion,
  ADMIN_EMAIL,
} from "./helpers";

const owner = () =>
  createUserWithSession({ email: "owner@example.com", username: "owner" });
const stranger = () =>
  createUserWithSession({ email: "other@example.com", username: "other" });
const admin = () =>
  createUserWithSession({ email: ADMIN_EMAIL, username: "boss" });

describe("a new deck starts as a draft", () => {
  it("hides an unpublished flashcard deck from everyone but its owner", async () => {
    const { token: ownerToken } = await owner();
    await createFlashcardDeck(ownerToken, { title: "Secret" });
    const { token: otherToken } = await stranger();

    const mine = await requestJson("/api/flashcard-decks", {
      token: ownerToken,
    });
    const theirs = await requestJson("/api/flashcard-decks", {
      token: otherToken,
    });
    const anon = await requestJson("/api/flashcard-decks");

    expect(mine.data.decks.map((d) => d.title)).toEqual(["Secret"]);
    expect(theirs.data.decks).toEqual([]);
    expect(anon.data.decks).toEqual([]);
  });

  it("hides an unpublished challenge deck from everyone but its owner", async () => {
    const { token: ownerToken } = await owner();
    await createChallengeDeck(ownerToken, { title: "Secret quiz" });
    const { token: otherToken } = await stranger();

    const mine = await requestJson("/api/challenge-decks", {
      token: ownerToken,
    });
    const theirs = await requestJson("/api/challenge-decks", {
      token: otherToken,
    });

    expect(mine.data.decks.map((d) => d.title)).toEqual(["Secret quiz"]);
    expect(theirs.data.decks).toEqual([]);
  });
});

describe("publishing needs three items, both kinds", () => {
  it("refuses to publish a flashcard deck with two cards", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    for (const n of [1, 2]) {
      await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
        method: "POST",
        token,
        body: { front: `f${n}`, meaning: `m${n}` },
      });
    }

    const { status, data } = await requestJson(
      `/api/flashcard-decks/${deckId}/publish`,
      { method: "POST", token },
    );
    expect(status).toBe(400);
    expect(data.error).toMatch(/at least 3 cards/);
  });

  it("refuses to publish an empty flashcard deck", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { status } = await requestJson(
      `/api/flashcard-decks/${deckId}/publish`,
      { method: "POST", token },
    );
    expect(status).toBe(400);
  });

  it("refuses to publish a challenge deck with two questions", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    for (const n of [1, 2]) {
      await requestJson(`/api/challenge-decks/${deckId}/cards`, {
        method: "POST",
        token,
        body: sampleQuestion(n),
      });
    }

    const { status, data } = await requestJson(
      `/api/challenge-decks/${deckId}/publish`,
      { method: "POST", token },
    );
    expect(status).toBe(400);
    expect(data.error).toMatch(/at least 3 cards/);
  });
});

describe("publishing makes a deck public", () => {
  it("reveals a flashcard deck to strangers once published", async () => {
    const { token: ownerToken } = await owner();
    const deckId = await createFlashcardDeck(ownerToken, { title: "Kanji" });
    const { token: otherToken } = await stranger();

    const before = await requestJson("/api/flashcard-decks", {
      token: otherToken,
    });
    expect(before.data.decks).toEqual([]);

    const result = await publishFlashcardDeck(ownerToken, deckId, 3);
    expect(result.is_published).toBe(1);
    expect(result.card_count).toBe(3);

    const after = await requestJson("/api/flashcard-decks", {
      token: otherToken,
    });
    expect(after.data.decks.map((d) => d.title)).toEqual(["Kanji"]);
  });

  it("reveals a challenge deck to strangers once published", async () => {
    const { token: ownerToken } = await owner();
    const deckId = await createChallengeDeck(ownerToken, { title: "Quiz" });
    const { token: otherToken } = await stranger();

    expect((await requestJson("/api/challenge-decks", { token: otherToken })).data.decks).toEqual([]);
    await publishChallenge(ownerToken, deckId, 3);

    const after = await requestJson("/api/challenge-decks", {
      token: otherToken,
    });
    expect(after.data.decks.map((d) => d.title)).toEqual(["Quiz"]);
  });
});

// Hiding drafts from the list would be cosmetic on its own — the read has to
// close too, or anyone could fetch a draft by guessing its id.
describe("a draft cannot be read by id either", () => {
  it("404s a draft challenge deck for a stranger but not its owner", async () => {
    const { token: ownerToken } = await owner();
    const deckId = await createChallengeDeck(ownerToken);
    const { token: otherToken } = await stranger();

    const mine = await requestJson(`/api/challenge-decks/${deckId}`, {
      token: ownerToken,
    });
    const theirs = await requestJson(`/api/challenge-decks/${deckId}`, {
      token: otherToken,
    });

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(404);
  });

  it("opens the read once published", async () => {
    const { token: ownerToken } = await owner();
    const deckId = await createChallengeDeck(ownerToken);
    const { token: otherToken } = await stranger();

    await publishChallenge(ownerToken, deckId, 3);
    const { status } = await requestJson(`/api/challenge-decks/${deckId}`, {
      token: otherToken,
    });
    expect(status).toBe(200);
  });

  it("lets an admin read anyone's draft by id", async () => {
    const { token: ownerToken } = await owner();
    const deckId = await createChallengeDeck(ownerToken, { title: "Draft" });
    const { token: adminToken } = await admin();

    const { status, data } = await requestJson(
      `/api/challenge-decks/${deckId}`,
      { token: adminToken },
    );
    expect(status).toBe(200);
    expect(data.deck.title).toBe("Draft");
  });
});

describe("drafts are hidden from admins too", () => {
  // A deliberate choice: the list filter is about relevance, not permission.
  // An admin moderating the site should not wade through everyone's
  // half-finished decks, and retains full access to any deck by id.
  it("keeps another user's drafts out of an admin's list", async () => {
    const { token: ownerToken } = await owner();
    await createFlashcardDeck(ownerToken, { title: "Someone's draft" });
    await createChallengeDeck(ownerToken, { title: "Someone's quiz draft" });

    const { token: adminToken } = await admin();
    const fc = await requestJson("/api/flashcard-decks", { token: adminToken });
    const ch = await requestJson("/api/challenge-decks", { token: adminToken });

    expect(fc.data.decks).toEqual([]);
    expect(ch.data.decks).toEqual([]);
  });

  it("still lets an admin open and delete a draft directly", async () => {
    const { token: ownerToken } = await owner();
    const deckId = await createFlashcardDeck(ownerToken, { title: "Draft" });
    const { token: adminToken } = await admin();

    const read = await requestJson(`/api/flashcard-decks/${deckId}`, {
      token: adminToken,
    });
    expect(read.status).toBe(200);
    expect(read.data.deck.title).toBe("Draft");

    const del = await requestJson(`/api/flashcard-decks/${deckId}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(del.status).toBe(200);
  });

  it("shows an admin their own drafts", async () => {
    const { token: adminToken } = await admin();
    await createFlashcardDeck(adminToken, { title: "My draft" });

    const { data } = await requestJson("/api/flashcard-decks", {
      token: adminToken,
    });
    expect(data.decks.map((d) => d.title)).toEqual(["My draft"]);
  });
});

describe("publish authorization", () => {
  it("403s when a stranger publishes someone else's deck", async () => {
    const { token: ownerToken } = await owner();
    const deckId = await createFlashcardDeck(ownerToken);
    for (const n of [1, 2, 3]) {
      await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
        method: "POST",
        token: ownerToken,
        body: { front: `f${n}`, meaning: `m${n}` },
      });
    }

    const { token: otherToken } = await stranger();
    const { status } = await requestJson(
      `/api/flashcard-decks/${deckId}/publish`,
      { method: "POST", token: otherToken },
    );
    expect(status).toBe(403);
  });

  it("401s without a session", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { status } = await requestJson(
      `/api/flashcard-decks/${deckId}/publish`,
      { method: "POST" },
    );
    expect(status).toBe(401);
  });

  it("404s publishing a deck that does not exist", async () => {
    const { token } = await owner();
    const { status } = await requestJson("/api/flashcard-decks/9999/publish", {
      method: "POST",
      token,
    });
    expect(status).toBe(404);
  });
});

describe("published state survives edits", () => {
  it("keeps a flashcard deck published after its cards change", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    await publishFlashcardDeck(token, deckId, 3);

    await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
      method: "POST",
      token,
      body: { front: "extra", meaning: "card" },
    });

    const row = await env.DB.prepare(
      "SELECT is_published FROM flashcard_decks WHERE id = ?",
    )
      .bind(deckId)
      .first();
    expect(row.is_published).toBe(1);
  });

  it("is idempotent — publishing twice is harmless", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    await publishFlashcardDeck(token, deckId, 3);

    const { status, data } = await requestJson(
      `/api/flashcard-decks/${deckId}/publish`,
      { method: "POST", token },
    );
    expect(status).toBe(200);
    expect(data.is_published).toBe(1);
  });
});
