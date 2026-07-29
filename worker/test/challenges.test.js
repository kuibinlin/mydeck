import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  requestJson,
  createUserWithSession,
  createChallengeDeck,
  createFlashcardDeck,
  publishChallenge,
  sampleQuestion,
} from "./helpers";

const owner = () =>
  createUserWithSession({ email: "owner@example.com", username: "owner" });
const stranger = () =>
  createUserWithSession({ email: "other@example.com", username: "other" });

const addQuestion = (token, deckId, body) =>
  requestJson(`/api/challenge-decks/${deckId}/cards`, {
    method: "POST",
    token,
    body,
  });

describe("GET /api/challenge-decks", () => {
  it("lists decks with author and published version info", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token, { title: "Quiz A" });
    await publishChallenge(token, deckId, 3);

    const { status, data } = await requestJson("/api/challenge-decks");
    expect(status).toBe(200);
    expect(data.decks[0].title).toBe("Quiz A");
    expect(data.decks[0].author).toBe("owner");
    expect(data.decks[0].current_version).toBe(1);
    expect(data.decks[0].card_count).toBe(3);
  });
});

describe("POST /api/challenge-decks", () => {
  it("401s without a session", async () => {
    const { status } = await requestJson("/api/challenge-decks", {
      method: "POST",
      body: { title: "x", category: "Language" },
    });
    expect(status).toBe(401);
  });

  it("requires title and category", async () => {
    const { token } = await owner();
    const { status } = await requestJson("/api/challenge-decks", {
      method: "POST",
      token,
      body: { title: "x" },
    });
    expect(status).toBe(400);
  });

  it("creates a deck link when linked_flashcard_deck_id is given", async () => {
    const { token } = await owner();
    const fcId = await createFlashcardDeck(token, { title: "Vocab" });
    const { data } = await requestJson("/api/challenge-decks", {
      method: "POST",
      token,
      body: {
        title: "Quiz",
        category: "Language",
        linked_flashcard_deck_id: fcId,
      },
    });

    const { data: deck } = await requestJson(`/api/challenge-decks/${data.id}`, { token });
    expect(deck.linked_flashcard_decks).toHaveLength(1);
    expect(deck.linked_flashcard_decks[0].title).toBe("Vocab");
  });
});

describe("GET /api/challenge-decks/:id", () => {
  it("returns null version and all_cards before publishing", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    await addQuestion(token, deckId, sampleQuestion(1));

    const { data } = await requestJson(`/api/challenge-decks/${deckId}`, { token });
    expect(data.version).toBeNull();
    expect(data.cards).toEqual([]);
    expect(data.all_cards).toHaveLength(1);
  });

  it("returns the published snapshot in cards after publishing", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    await publishChallenge(token, deckId, 3);
    await addQuestion(token, deckId, sampleQuestion(99));

    const { data } = await requestJson(`/api/challenge-decks/${deckId}`, { token });
    expect(data.version.version).toBe(1);
    expect(data.cards).toHaveLength(3); // snapshot, excludes the new question
    expect(data.all_cards).toHaveLength(4);
  });

  it("404s for a missing deck", async () => {
    const { status } = await requestJson("/api/challenge-decks/9999");
    expect(status).toBe(404);
  });
});

describe("POST /api/challenge-decks/:id/cards", () => {
  it("403s for a non-owner", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { token: otherToken } = await stranger();
    const { status } = await addQuestion(otherToken, deckId, sampleQuestion());
    expect(status).toBe(403);
  });

  it("requires question, choices and answer", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { status, data } = await addQuestion(token, deckId, {
      question: "q",
    });
    expect(status).toBe(400);
    expect(data.error).toBe("Question, choices, and answer required");
  });

  it("requires exactly four choices", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { status, data } = await addQuestion(token, deckId, {
      question: "q",
      choices: ["a", "b", "c"],
      answer: 0,
    });
    expect(status).toBe(400);
    expect(data.error).toBe("Exactly 4 choices required");
  });

  it("requires the answer to be 0-3", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { status, data } = await addQuestion(token, deckId, {
      question: "q",
      choices: ["a", "b", "c", "d"],
      answer: 7,
    });
    expect(status).toBe(400);
    expect(data.error).toBe("Answer must be 0-3");
  });

  it("accepts answer index 0", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { status } = await addQuestion(token, deckId, {
      question: "q",
      choices: ["a", "b", "c", "d"],
      answer: 0,
    });
    expect(status).toBe(201);
  });

  it("enforces question and choice length limits", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);

    const longQ = await addQuestion(token, deckId, {
      question: "q".repeat(501),
      choices: ["a", "b", "c", "d"],
      answer: 0,
    });
    expect(longQ.status).toBe(400);

    const longChoice = await addQuestion(token, deckId, {
      question: "q",
      choices: ["a".repeat(301), "b", "c", "d"],
      answer: 0,
    });
    expect(longChoice.status).toBe(400);
  });

  it("enforces MAX_QUESTIONS_PER_DECK", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const limit = parseInt(env.MAX_QUESTIONS_PER_DECK, 10);

    for (let i = 0; i < limit; i++) {
      await env.DB.prepare(
        "INSERT INTO challenge_cards (deck_id, question, choices, answer) VALUES (?, ?, ?, ?)",
      )
        .bind(deckId, `q${i}`, JSON.stringify(["a", "b", "c", "d"]), 0)
        .run();
    }

    const { status, data } = await addQuestion(token, deckId, sampleQuestion());
    expect(status).toBe(400);
    expect(data.error).toContain(`${limit}-question limit`);
  });

  it("stores choices as a JSON string", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { data } = await addQuestion(token, deckId, sampleQuestion(1));

    const row = await env.DB.prepare(
      "SELECT choices FROM challenge_cards WHERE id = ?",
    )
      .bind(data.id)
      .first();
    expect(JSON.parse(row.choices)).toEqual(["A1", "B1", "C1", "D1"]);
  });
});

describe("PUT /api/challenge-decks/:id", () => {
  it("preserves the deck link when linked_flashcard_deck_id is omitted", async () => {
    const { token } = await owner();
    const fcId = await createFlashcardDeck(token, { title: "Vocab" });
    const { data: created } = await requestJson("/api/challenge-decks", {
      method: "POST",
      token,
      body: {
        title: "Quiz",
        category: "Language",
        linked_flashcard_deck_id: fcId,
      },
    });

    await requestJson(`/api/challenge-decks/${created.id}`, {
      method: "PUT",
      token,
      body: { article: "some article" },
    });

    const { data } = await requestJson(`/api/challenge-decks/${created.id}`, { token });
    expect(data.linked_flashcard_decks).toHaveLength(1);
    expect(data.deck.article).toBe("some article");
  });

  it("removes the deck link when linked_flashcard_deck_id is explicitly null", async () => {
    const { token } = await owner();
    const fcId = await createFlashcardDeck(token);
    const { data: created } = await requestJson("/api/challenge-decks", {
      method: "POST",
      token,
      body: {
        title: "Quiz",
        category: "Language",
        linked_flashcard_deck_id: fcId,
      },
    });

    await requestJson(`/api/challenge-decks/${created.id}`, {
      method: "PUT",
      token,
      body: { title: "Quiz", linked_flashcard_deck_id: null },
    });

    const { data } = await requestJson(`/api/challenge-decks/${created.id}`, { token });
    expect(data.linked_flashcard_decks).toHaveLength(0);
  });

  it("clears the article when the field is omitted", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    await requestJson(`/api/challenge-decks/${deckId}`, {
      method: "PUT",
      token,
      body: { article: "kept for now" },
    });

    await requestJson(`/api/challenge-decks/${deckId}`, {
      method: "PUT",
      token,
      body: { title: "Renamed" },
    });

    const { data } = await requestJson(`/api/challenge-decks/${deckId}`, { token });
    expect(data.deck.article).toBeNull();
  });

  it("403s for a non-owner", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { token: otherToken } = await stranger();
    const { status } = await requestJson(`/api/challenge-decks/${deckId}`, {
      method: "PUT",
      token: otherToken,
      body: { title: "Hijack" },
    });
    expect(status).toBe(403);
  });
});

describe("PUT/DELETE /api/challenge-cards/:id", () => {
  it("404s for a missing card", async () => {
    const { token } = await owner();
    const { status } = await requestJson("/api/challenge-cards/9999", {
      method: "PUT",
      token,
      body: { question: "q" },
    });
    expect(status).toBe(404);
  });

  it("403s when the card belongs to someone else", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { data: card } = await addQuestion(token, deckId, sampleQuestion());
    const { token: otherToken } = await stranger();

    const { status } = await requestJson(`/api/challenge-cards/${card.id}`, {
      method: "PUT",
      token: otherToken,
      body: { question: "hijack" },
    });
    expect(status).toBe(403);
  });

  it("validates choices and answer on update", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { data: card } = await addQuestion(token, deckId, sampleQuestion());

    const badChoices = await requestJson(`/api/challenge-cards/${card.id}`, {
      method: "PUT",
      token,
      body: { choices: ["a", "b"] },
    });
    expect(badChoices.status).toBe(400);

    const badAnswer = await requestJson(`/api/challenge-cards/${card.id}`, {
      method: "PUT",
      token,
      body: { answer: 9 },
    });
    expect(badAnswer.status).toBe(400);
  });

  it("updates a card", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { data: card } = await addQuestion(token, deckId, sampleQuestion());

    const { status } = await requestJson(`/api/challenge-cards/${card.id}`, {
      method: "PUT",
      token,
      body: { question: "updated?", choices: ["w", "x", "y", "z"], answer: 2 },
    });
    expect(status).toBe(200);

    const { data } = await requestJson(`/api/challenge-decks/${deckId}`, { token });
    expect(data.all_cards[0].question).toBe("updated?");
    expect(data.all_cards[0].answer).toBe(2);
  });

  it("soft-deletes a card", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { data: card } = await addQuestion(token, deckId, sampleQuestion());

    await requestJson(`/api/challenge-cards/${card.id}`, {
      method: "DELETE",
      token,
    });

    const row = await env.DB.prepare(
      "SELECT is_deleted FROM challenge_cards WHERE id = ?",
    )
      .bind(card.id)
      .first();
    expect(row.is_deleted).toBe(1);
  });
});

describe("POST /api/challenge-decks/:id/publish", () => {
  it("refuses to publish fewer than three cards", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    await addQuestion(token, deckId, sampleQuestion(1));
    await addQuestion(token, deckId, sampleQuestion(2));

    const { status, data } = await requestJson(
      `/api/challenge-decks/${deckId}/publish`,
      { method: "POST", token },
    );
    expect(status).toBe(400);
    expect(data.error).toBe("Need at least 3 cards to publish");
  });

  it("publishes version 1 then increments", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const first = await publishChallenge(token, deckId, 3);
    expect(first.version).toBe(1);
    expect(first.card_count).toBe(3);

    await addQuestion(token, deckId, sampleQuestion(4));
    const { data: second } = await requestJson(
      `/api/challenge-decks/${deckId}/publish`,
      { method: "POST", token },
    );
    expect(second.version).toBe(2);
    expect(second.card_count).toBe(4);
  });

  it("403s for a non-owner", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    await publishChallenge(token, deckId, 3);
    const { token: otherToken } = await stranger();

    const { status } = await requestJson(
      `/api/challenge-decks/${deckId}/publish`,
      { method: "POST", token: otherToken },
    );
    expect(status).toBe(403);
  });
});

describe("DELETE /api/challenge-decks/:id", () => {
  it("removes the deck, its cards, versions and scores", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { versionId, cardCount } = await publishChallenge(token, deckId, 3);
    await requestJson("/api/scores", {
      method: "POST",
      token,
      body: {
        challenge_version_id: versionId,
        score: 2,
        total: cardCount,
      },
    });

    const { status } = await requestJson(`/api/challenge-decks/${deckId}`, {
      method: "DELETE",
      token,
    });
    expect(status).toBe(200);

    for (const table of [
      "challenge_cards",
      "challenge_versions",
      "deck_links",
    ]) {
      const { n } = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM ${table} WHERE ${table === "deck_links" ? "challenge_deck_id" : "deck_id"} = ?`,
      )
        .bind(deckId)
        .first();
      expect(n, table).toBe(0);
    }

    const { n: scoreCount } = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM scores WHERE challenge_version_id = ?",
    )
      .bind(versionId)
      .first();
    expect(scoreCount).toBe(0);
  });
});
