// The tutor turn, driven by a scripted model.
//
// Everything this file covers was previously untested: deckSave.test.js calls
// `saveWords` directly and zh.test.js cannot reach the tutor at all (the test
// config has no [ai] binding, so the model is unreachable by design and that
// suite asserts the degraded path). Nothing asserted that a card ever landed in
// D1 through model → tool → service → database, which is the one claim the
// "add to a deck" button actually makes.
//
// callModel is stubbed the same way agentLoop.test.js does it, so the model's
// judgement is out of the picture and what is left is the wiring.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { respond } from "../src/services/tutor.js";
import * as callModelModule from "../src/ai/callModel.js";
import { createUser } from "./helpers.js";

const turn = (text, toolCalls = []) => ({
  text,
  toolCalls,
  stopReason: toolCalls.length ? "tool_calls" : "stop",
  usage: null,
  raw: {},
});

const call = (name, input, id = "c1") => ({ id, name, input });

function scriptModel(turns) {
  let i = 0;
  return vi.spyOn(callModelModule, "callModel").mockImplementation(async () => {
    const t = turns[Math.min(i, turns.length - 1)];
    i++;
    return t;
  });
}

// What resolveMany hands `respond` for a one-word message. Real shape, so the
// seeding and the save read the same fields they do in production.
const card = (word, pinyin, meaning, level = 1) => ({
  word,
  pinyin,
  meaning,
  level,
  found: true,
  source: "bundle",
});

const cardsIn = (deckId) =>
  env.DB.prepare("SELECT front, meaning, note FROM flashcards WHERE deck_id = ? AND is_deleted = 0")
    .bind(deckId)
    .all()
    .then((r) => r.results);

let spy;
let user;
beforeEach(async () => {
  vi.restoreAllMocks();
  user = await createUser();
});
afterEach(() => spy?.mockRestore());

describe("saving words to a deck", () => {
  it("writes real cards into a real draft deck", async () => {
    spy = scriptModel([
      turn("", [call("save_words_to_deck", {})]),
      turn("Saved 书 to a new deck."),
    ]);

    const out = await respond(env, {
      user,
      message: "save 书 to a deck",
      seed: [card("书", "shū", "book")],
    });

    expect(out.saves).toHaveLength(1);
    expect(out.saveFailed).toBe(false);

    const save = out.saves[0];
    expect(save.added.map((a) => a.word)).toEqual(["书"]);
    expect(save.published).toBe(false);

    // The claim the button makes, checked against the database rather than
    // against the tool's own return value.
    const deck = await env.DB.prepare(
      "SELECT is_published, created_by FROM flashcard_decks WHERE id = ?",
    )
      .bind(save.deckId)
      .first();
    expect(deck.is_published).toBe(0);
    expect(deck.created_by).toBe(user.id);
    expect(await cardsIn(save.deckId)).toEqual([
      { front: "书", meaning: "book", note: "shū" },
    ]);
  });

  it("saves the word the learner meant when the model corrupts the characters", async () => {
    // 书 retyped by the model as 弗. Trusting it verbatim saved nothing at all;
    // a name that matches nothing real now selects from the words this turn
    // resolved instead.
    spy = scriptModel([
      turn("", [call("save_words_to_deck", { words: ["弗"] })]),
      turn("Saved it."),
    ]);

    const out = await respond(env, {
      user,
      message: "save 书 to a deck",
      seed: [card("书", "shū", "book")],
    });

    expect(out.saves).toHaveLength(1);
    expect(out.saves[0].added.map((a) => a.word)).toEqual(["书"]);
    expect(await cardsIn(out.saves[0].deckId)).toHaveLength(1);
  });

  it("honours a named word that is real, without widening to the rest", async () => {
    spy = scriptModel([
      turn("", [call("save_words_to_deck", { words: ["书"] })]),
      turn("Saved 书."),
    ]);

    const out = await respond(env, {
      user,
      message: "save 书 to a deck",
      seed: [card("书", "shū", "book"), card("人", "rén", "person")],
    });

    expect(out.saves[0].added.map((a) => a.word)).toEqual(["书"]);
  });
});

describe("saving a word from an earlier turn", () => {
  it("saves what the conversation was about when this message names nothing", async () => {
    // The whole point of the ledger. "save that to a deck" resolves no
    // characters, so without the words carried forward this is the "No words to
    // save." failure — which is what it did before.
    spy = scriptModel([
      turn("", [call("save_words_to_deck", {})]),
      turn("Saved it."),
    ]);

    const out = await respond(env, {
      user,
      message: "save that to a deck",
      seed: [],
      context: { words: ["书"] },
    });

    expect(out.saveFailed).toBe(false);
    expect(out.saves[0].added.map((a) => a.word)).toEqual(["书"]);
  });

  it("puts this turn's word ahead of older ones", async () => {
    // saveWords keeps the first MAX_SAVE, so order is priority: "save that"
    // must mean the word just discussed.
    let sent = null;
    spy = vi.spyOn(callModelModule, "callModel").mockImplementation(async () => {
      if (sent) return turn("done");
      sent = true;
      return turn("", [call("save_words_to_deck", {})]);
    });

    const out = await respond(env, {
      user,
      message: "save 人 to a deck",
      seed: [card("人", "rén", "person")],
      context: { words: ["书"] },
    });

    expect(out.saves[0].added.map((a) => a.word)).toEqual(["人", "书"]);
  });

  it("ignores a carried word the dictionary does not know", async () => {
    spy = scriptModel([
      turn("", [call("save_words_to_deck", {})]),
      turn("Saved."),
    ]);

    const out = await respond(env, {
      user,
      message: "save that to a deck",
      seed: [card("书", "shū", "book")],
      context: { words: ["翰译"] },
    });

    expect(out.saves[0].added.map((a) => a.word)).toEqual(["书"]);
  });
});

describe("a save that did not happen", () => {
  it("reports failure when the model asks for a tool it was not offered", async () => {
    // No save intent in the message, so the tool is withheld — and the model
    // reaches for it anyway, which is the case the allowlist exists for. The
    // refusal has to be counted, or `saveFailed` cannot contradict the prose.
    spy = scriptModel([
      turn("", [call("save_words_to_deck", {})]),
      turn("I've added it to your deck."),
    ]);

    const out = await respond(env, {
      user,
      message: "what does 书 mean",
      seed: [card("书", "shū", "book")],
    });

    expect(out.saves).toEqual([]);
    expect(out.saveFailed).toBe(true);

    const decks = await env.DB.prepare("SELECT COUNT(*) as n FROM flashcard_decks").first();
    expect(decks.n).toBe(0);
  });

  it("reports failure when there are no words to save", async () => {
    // "save that to a deck" is all Latin, so it resolves nothing and the seed
    // is empty. The save cannot succeed; what matters is that it says so.
    spy = scriptModel([
      turn("", [call("save_words_to_deck", {})]),
      turn("Done!"),
    ]);

    const out = await respond(env, { user, message: "save that to a deck", seed: [] });

    expect(out.saves).toEqual([]);
    expect(out.saveFailed).toBe(true);
  });

  it("stays silent when no save was ever attempted", async () => {
    spy = scriptModel([turn("书 means book.")]);

    const out = await respond(env, {
      user,
      message: "what does 书 mean",
      seed: [card("书", "shū", "book")],
    });

    expect(out.saveFailed).toBe(false);
    expect(out.saves).toEqual([]);
  });
});

describe("what the model is asked", () => {
  it("sends one system message, first, with the learner's line last", async () => {
    // SEA-LION's gateway 400s a system message that is not first, and the
    // current message is where models weight hardest. Both are load-bearing.
    const seen = [];
    spy = vi.spyOn(callModelModule, "callModel").mockImplementation(async (messages) => {
      seen.push(messages);
      return turn("ok");
    });

    await respond(env, { user, message: "what does 书 mean", seed: [card("书", "shū", "book")] });

    const roles = seen[0].map((m) => m.role);
    expect(roles.filter((r) => r === "system")).toHaveLength(1);
    expect(roles[0]).toBe("system");
    expect(seen[0].at(-1)).toEqual({ role: "user", content: "what does 书 mean" });
  });

  it("puts earlier turns between the system message and the current one", async () => {
    const seen = [];
    spy = vi.spyOn(callModelModule, "callModel").mockImplementation(async (messages) => {
      seen.push(messages);
      return turn("ok");
    });

    await respond(env, {
      user,
      message: "and that one?",
      seed: [],
      context: { turns: [{ q: "what does 书 mean", a: "书 means book." }] },
    });

    expect(seen[0].map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(seen[0][1].content).toBe("what does 书 mean");
    expect(seen[0].at(-1).content).toBe("and that one?");
    // The shape every provider accepts unchanged. A stored tool call would be
    // provider-specific and a system message out of position is a 400.
    expect(seen[0].some((m) => m.tool_calls || m.role === "tool")).toBe(false);
  });

  it("offers the save tool only when the message asks for one", async () => {
    const toolsFor = async (message) => {
      let offered = null;
      spy = vi.spyOn(callModelModule, "callModel").mockImplementation(async (_m, opts) => {
        offered = opts.tools.map((t) => t.name ?? t.function?.name);
        return turn("ok");
      });
      await respond(env, { user, message, seed: [card("书", "shū", "book")] });
      spy.mockRestore();
      return offered;
    };

    expect(await toolsFor("save 书 to a deck")).toContain("save_words_to_deck");
    expect(await toolsFor("what does 书 mean")).not.toContain("save_words_to_deck");
  });
});
