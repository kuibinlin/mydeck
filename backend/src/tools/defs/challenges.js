// Challenge tools. See defs/flashcards.js for the shape and the rule that
// logic stays in services/.

import * as challenges from "../../services/challenges.js";

export const listChallengeDecks = {
  name: "list_challenge_decks",
  description:
    "List every challenge deck with its author, current published version and question count.",
  inputSchema: { type: "object", properties: {}, required: [] },
  // The acting user's own drafts are included; other people's are not.
  execute: (env, ctx) => challenges.listDecks(env, { user: ctx?.user ?? null }),
};

export const getChallengeDeck = {
  name: "get_challenge_deck",
  description:
    "Read one challenge deck: metadata, the published question snapshot, all current questions, and linked flashcard decks.",
  inputSchema: {
    type: "object",
    properties: {
      deckId: { type: "number", description: "Id of the challenge deck" },
    },
    required: ["deckId"],
  },
  execute: (env, ctx, { deckId }) =>
    challenges.getDeck(env, { deckId, user: ctx?.user ?? null }),
};

export const addChallengeCard = {
  name: "add_challenge_card",
  description:
    "Add one multiple-choice question to a challenge deck the current user owns. Requires exactly four choices.",
  inputSchema: {
    type: "object",
    properties: {
      deckId: { type: "number", description: "Id of the challenge deck" },
      question: { type: "string", description: "The question text" },
      choices: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 4,
        description: "Exactly four answer options",
      },
      answer: {
        type: "number",
        description: "Zero-based index of the correct choice, 0 to 3",
      },
    },
    required: ["deckId", "question", "choices", "answer"],
  },
  execute: (env, ctx, args) =>
    challenges.addCard(env, { ...args, user: ctx.user }),
};

export const publishChallenge = {
  name: "publish_challenge",
  description:
    "Publish a new version of a challenge deck, snapshotting its current questions. Existing leaderboard scores stay attached to their old version. Needs at least three questions.",
  inputSchema: {
    type: "object",
    properties: {
      deckId: { type: "number", description: "Id of the challenge deck" },
    },
    required: ["deckId"],
  },
  execute: (env, ctx, { deckId }) =>
    challenges.publish(env, { deckId, user: ctx.user }),
};
