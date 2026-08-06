// One tool for every activity, not one per activity.
//
// Three near-identical tools (create_stroke_sheet / create_match_game / …) are
// the hardest possible discrimination for a model: same vocabulary, same
// arguments, same intent. A single tool with a type enum turns a tool-choice
// problem into an argument-choice problem, which models are markedly better at.
// It also gives every activity one result contract, and adding the next one is
// an enum value rather than a wider tool surface.
//
// `source` is optional on purpose. Phase 0 measured the model inventing a deck
// id it had never looked up; letting the service choose removes both that and
// the list-then-choose round trip.

import * as activities from "../../services/activities.js";

export const createActivity = {
  name: "create_activity",
  description:
    "Build an interactive practice activity and show it to the learner. " +
    "type 'stroke' is an animated stroke-order writing sheet — use it when they want to learn " +
    "to WRITE a character. " +
    "type 'match' is a word/meaning matching game — use it when they want to play, practise, " +
    "be quizzed or be tested. " +
    "Leave the source out and the learner's own most recent deck is used, or a set at their " +
    "level if they have none. Only name `words` when the activity is about specific words you " +
    "already have in front of you — copy them exactly. Never guess a deckId.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["stroke", "match"],
        description: "'stroke' to practise writing, 'match' to be quizzed.",
      },
      words: {
        type: "array",
        items: { type: "string" },
        maxItems: 12,
        description: "Specific Chinese words, copied exactly. Optional.",
      },
      deckId: {
        type: "number",
        description: "A deck id you have actually seen from a previous tool result. Optional.",
      },
      level: {
        type: "integer",
        minimum: 1,
        maximum: 7,
        description: "HSK level to draw from when there is no deck. Optional.",
      },
      title: { type: "string", description: "Short heading shown above it. Optional." },
    },
    required: ["type"],
  },
  execute: (env, ctx, args) => activities.create(env, { ...args, user: ctx.user }),
};
