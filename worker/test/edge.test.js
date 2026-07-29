import { describe, it, expect } from "vitest";
import {
  requestJson,
  createUserWithSession,
  createFlashcardDeck,
  createChallengeDeck,
} from "./helpers";

// Methods that the URL pattern matches but no handler branch answers.
//
// Before the refactor these fell off the end of their handler and returned
// undefined, which crashes the runtime with:
//   "Incorrect type for Promise: the Promise did not resolve to 'Response'"
//
// The route table now matches on method as well as path, so these are plain
// 404s. This is the one deliberate behaviour change in the refactor, and it
// only affects requests the frontend never makes.
describe("unhandled methods on matched routes", () => {
  const owner = () =>
    createUserWithSession({ email: "o@example.com", username: "o" });

  it("404s GET /api/flashcards/:id", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { data: card } = await requestJson(
      `/api/flashcard-decks/${deckId}/cards`,
      { method: "POST", token, body: { front: "f", meaning: "m" } },
    );
    const { status } = await requestJson(`/api/flashcards/${card.id}`, {
      token,
    });
    expect(status).toBe(404);
  });

  it("404s POST /api/flashcard-decks/:id", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { status } = await requestJson(`/api/flashcard-decks/${deckId}`, {
      method: "POST",
      token,
      body: {},
    });
    expect(status).toBe(404);
  });

  it("404s GET /api/challenge-cards/:id", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { data: card } = await requestJson(
      `/api/challenge-decks/${deckId}/cards`,
      {
        method: "POST",
        token,
        body: { question: "q", choices: ["a", "b", "c", "d"], answer: 0 },
      },
    );
    const { status } = await requestJson(`/api/challenge-cards/${card.id}`, {
      token,
    });
    expect(status).toBe(404);
  });

  it("404s DELETE /api/challenge-decks/:id/publish", async () => {
    const { token } = await owner();
    const deckId = await createChallengeDeck(token);
    const { status } = await requestJson(
      `/api/challenge-decks/${deckId}/publish`,
      { method: "DELETE", token },
    );
    expect(status).toBe(404);
  });
});
