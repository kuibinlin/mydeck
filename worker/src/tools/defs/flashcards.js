// Flashcard tools.
//
// Each definition is a thin wrapper: a JSON Schema the model can read, plus an
// execute() that calls the same service function the HTTP route calls. No
// business rules live here — deck limits, ownership and validation are all
// enforced inside services/flashcards.js.

import * as flashcards from "../../services/flashcards.js";
import * as aiContent from "../../services/aiContent.js";

export const listFlashcardDecks = {
  name: "list_flashcard_decks",
  description:
    "List every flashcard deck with its title, category, author and card count. Use this to find a deck id before reading or modifying it.",
  inputSchema: { type: "object", properties: {}, required: [] },
  // The acting user's own drafts are included; other people's are not.
  execute: (env, ctx) => flashcards.listDecks(env, { user: ctx?.user ?? null }),
};

export const getFlashcardDeck = {
  name: "get_flashcard_deck",
  description:
    "Read one flashcard deck: its metadata, all its cards (front, meaning, note) and any linked challenge decks.",
  inputSchema: {
    type: "object",
    properties: {
      deckId: { type: "number", description: "Id of the flashcard deck" },
    },
    required: ["deckId"],
  },
  execute: (env, ctx, { deckId }) =>
    flashcards.getDeck(env, { deckId, user: ctx?.user ?? null }),
};

export const addFlashcard = {
  name: "add_flashcard",
  description:
    "Add one card to a flashcard deck the current user owns. Fails if the deck is full or belongs to someone else.",
  inputSchema: {
    type: "object",
    properties: {
      deckId: { type: "number", description: "Id of the flashcard deck" },
      front: { type: "string", description: "Term or prompt side" },
      meaning: { type: "string", description: "Definition or translation" },
      note: {
        type: "string",
        description: "Optional example sentence or mnemonic",
      },
    },
    required: ["deckId", "front", "meaning"],
  },
  execute: (env, ctx, args) =>
    flashcards.addCard(env, { ...args, user: ctx.user }),
};

export const publishFlashcardDeck = {
  name: "publish_flashcard_deck",
  description:
    "Publish a flashcard deck the current user owns, making it visible to everyone. Needs at least three cards. Until published, only the owner can see the deck.",
  inputSchema: {
    type: "object",
    properties: {
      deckId: { type: "number", description: "Id of the flashcard deck" },
    },
    required: ["deckId"],
  },
  execute: (env, ctx, { deckId }) =>
    flashcards.publish(env, { deckId, user: ctx.user }),
};

export const generateFlashcards = {
  name: "generate_flashcards",
  description:
    "Generate flashcards from an article using the configured language model. Returns the cards for review; it does not save them. Counts against the user's daily AI quota.",
  inputSchema: {
    type: "object",
    properties: {
      article: {
        type: "string",
        description: "Source text, at most 10000 characters",
      },
      count: {
        type: "number",
        description: "How many cards to generate, 1 to 30",
      },
      frontHint: {
        type: "string",
        description: "What the front of each card should contain",
      },
      meaningHint: {
        type: "string",
        description: "What the meaning field should contain",
      },
      noteHint: {
        type: "string",
        description: "What the note field should contain",
      },
    },
    required: ["article", "count"],
  },
  execute: (env, ctx, args) =>
    aiContent.generateFlashcards(env, { ...args, user: ctx.user }),
};
