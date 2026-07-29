// The route table: [method, pattern, handler].
//
// This is the whole public API surface of the worker in one readable list.
// Adding an endpoint means adding a line here and a handler in the matching
// route module — nothing else.

import * as auth from "./auth.js";
import * as flashcards from "./flashcards.js";
import * as challenges from "./challenges.js";
import * as scores from "./scores.js";
import * as deckLinks from "./deckLinks.js";
import * as ai from "./ai.js";

export const routes = [
  ["POST", "/auth/login", auth.login],
  ["GET", "/auth/verify", auth.verify],
  ["GET", "/auth/github", auth.githubStart],
  ["GET", "/auth/github/callback", auth.githubCallback],
  ["GET", "/auth/me", auth.me],
  ["POST", "/auth/logout", auth.logout],

  ["GET", "/api/flashcard-decks", flashcards.listDecks],
  ["POST", "/api/flashcard-decks", flashcards.createDeck],
  ["GET", "/api/flashcard-decks/:deckId", flashcards.getDeck],
  ["PUT", "/api/flashcard-decks/:deckId", flashcards.updateDeck],
  ["DELETE", "/api/flashcard-decks/:deckId", flashcards.deleteDeck],
  ["POST", "/api/flashcard-decks/:deckId/cards", flashcards.addCard],
  ["POST", "/api/flashcard-decks/:deckId/publish", flashcards.publish],
  ["PUT", "/api/flashcards/:cardId", flashcards.updateCard],
  ["DELETE", "/api/flashcards/:cardId", flashcards.deleteCard],

  ["GET", "/api/challenge-decks", challenges.listDecks],
  ["POST", "/api/challenge-decks", challenges.createDeck],
  ["GET", "/api/challenge-decks/:deckId", challenges.getDeck],
  ["PUT", "/api/challenge-decks/:deckId", challenges.updateDeck],
  ["DELETE", "/api/challenge-decks/:deckId", challenges.deleteDeck],
  ["POST", "/api/challenge-decks/:deckId/cards", challenges.addCard],
  ["POST", "/api/challenge-decks/:deckId/publish", challenges.publish],
  ["PUT", "/api/challenge-cards/:cardId", challenges.updateCard],
  ["DELETE", "/api/challenge-cards/:cardId", challenges.deleteCard],

  ["POST", "/api/scores", scores.submit],
  ["GET", "/api/leaderboard-summary", scores.summary],
  ["GET", "/api/leaderboard/:versionId", scores.leaderboard],

  ["POST", "/api/deck-links", deckLinks.create],
  ["GET", "/api/deck-links", deckLinks.list],
  ["DELETE", "/api/deck-links/:linkId", deckLinks.remove],

  ["GET", "/api/ai/settings", ai.usage],
  ["POST", "/api/ai/generate-flashcards", ai.generateFlashcards],
  ["POST", "/api/ai/generate-vocab", ai.generateVocab],
  ["POST", "/api/ai/generate-comprehension", ai.generateComprehension],
];
