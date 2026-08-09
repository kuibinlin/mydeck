// HSK vocabulary tools.
//
// Three, not thirteen. The server offers thirteen, but five of them return data
// `hsk_lookup` already carries (frequency, transcriptions, classifiers,
// traditional form, level), and folding those in removes five near-synonyms a
// model would otherwise have to tell apart. The remaining five — radical search,
// polyphones, homophones, compare, level diff — answer real but narrow
// questions and stay out of the tutor's routing problem. They belong to the
// level-assessment item builder, which is code and has no routing problem.
//
// Descriptions carry the routing, so no two share a trigger phrase. Phase 0
// measured 14/18 correct routing with wording close to this.
//
// Every execute() delegates to services/hsk.js, so an agent and an HTTP route
// get identical projection, fallback and limits.

import * as hsk from "../../services/hsk.js";

export const hskLookup = {
  name: "hsk_lookup",
  description:
    "Look up ONE Chinese word. Returns pinyin, English meanings, HSK level, frequency rank, " +
    "radical, traditional form and measure word (classifier). Accepts simplified, traditional " +
    "or pinyin. Use for: what does X mean, how is X pronounced, what HSK level is X, what is " +
    "the measure word for X, what is X in traditional. " +
    "If it comes back found:false the word is not in the HSK vocabulary — say so plainly and " +
    "do not invent a meaning or a level.",
  inputSchema: {
    type: "object",
    properties: {
      word: {
        type: "string",
        description: "One Chinese word, e.g. 翻译. Copy it exactly from the learner's message.",
      },
    },
    required: ["word"],
  },
  execute: (env, ctx, args) => hsk.lookup(env, args),
};

export const hskWordList = {
  name: "hsk_word_list",
  description:
    "Get a LIST of HSK vocabulary at one level, most frequent first. Use for: give me N words " +
    "at level L, what should I study next, HSK N vocabulary. " +
    "Pass `known` with words the learner already has to exclude them, which turns this into a " +
    "personal recommendation rather than a generic list.",
  inputSchema: {
    type: "object",
    properties: {
      level: { type: "integer", minimum: 1, maximum: 7, description: "HSK level, 1 to 7." },
      limit: { type: "integer", minimum: 1, maximum: 20, description: "How many words. Default 10." },
      known: {
        type: "array",
        items: { type: "string" },
        description: "Simplified words to leave out, e.g. ['你好','谢谢'].",
      },
      scheme: {
        type: "string",
        enum: ["new", "old"],
        description: "'new' is HSK 3.0 and the default; 'old' is HSK 2.0.",
      },
    },
    required: ["level"],
  },
  execute: (env, ctx, args) => hsk.wordList(env, args),
};

export const hskSearch = {
  name: "hsk_search",
  description:
    "Find Chinese words by their ENGLISH meaning. Use when the learner asks 'how do you say X " +
    "in Chinese', or gives an English word and wants the Chinese for it. " +
    "Do not use this for a word already written in Chinese — that is hsk_lookup.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "English meaning, e.g. 'to recommend'." },
      limit: { type: "integer", minimum: 1, maximum: 10, description: "How many matches. Default 6." },
    },
    required: ["query"],
  },
  execute: (env, ctx, args) => hsk.search(env, args),
};
