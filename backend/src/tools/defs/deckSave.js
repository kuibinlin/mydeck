// Saving words to a deck.
//
// One batch call, never one call per word. Twenty words as twenty tool calls
// would blow the step cap, spend twenty turns of quota, and give the model
// twenty chances to mistype a character. It also reads wrong to the learner:
// "saved" is one event, not a progress bar.
//
// There is deliberately no publish tool. See services/deckSave.js.

import * as deckSave from "../../services/deckSave.js";

export const saveWordsToDeck = {
  name: "save_words_to_deck",
  description:
    "Save Chinese words to one of the learner's flashcard decks so they can study them later. " +
    "Use this when they ask to save, keep, remember or add words. Send everything in ONE call. " +
    "LEAVE `words` OUT to save the words already on screen — the ones looked up for this " +
    "message and any you have just put in an activity. That is almost always what is wanted, " +
    "and it saves the exact characters rather than your retyping of them. " +
    "Only name `words` to save a different set, and then copy them character for character. " +
    "Name the deck with `deck` when the learner names one; it is created if they do not have " +
    "it. Every deck this makes is a private draft — the learner publishes it themselves.",
  inputSchema: {
    type: "object",
    properties: {
      words: {
        type: "array",
        items: { type: "string" },
        maxItems: 20,
        description:
          "Optional, and best omitted. Leave it out to save the words already on screen.",
      },
      deck: {
        type: "string",
        description:
          "The deck by NAME, e.g. 'Hospital words' — theirs if it exists, otherwise it is " +
          "created. Never an id number. Optional; omit and one is named for them.",
      },
    },
    // Nothing is required: the useful call is the one with no arguments at all.
    // The tutor fills `words` from what is already on screen when it is absent,
    // which is both the common case and the only one that cannot corrupt a
    // character. See services/tutor.js.
    required: [],
  },
  execute: (env, ctx, args) =>
    deckSave.saveWords(env, { ...args, user: ctx.user, resolved: ctx.resolved }),
};
