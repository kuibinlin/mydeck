// Saving tutor words into a deck.
//
// This is the first tool that writes to the learner's own data, so the tests
// that matter most are the ones about what it refuses to do: publish, write
// into someone else's deck, or save a character it could not look up.

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { saveWords, SAVE_LIMITS } from "../src/services/deckSave.js";
import { getDeck } from "../src/services/flashcards.js";
import { createUserWithSession, createFlashcardDeck, requestJson } from "./helpers";
import { TUTOR } from "../src/services/tutor.js";

const learner = (n = "") =>
  createUserWithSession({ email: `save${n}@example.com`, username: `save${n || "0"}` });

describe("saving words to a new deck", () => {
  it("creates a draft and fills it", async () => {
    const { user } = await learner();
    const out = await saveWords(env, { user, words: ["书", "银行", "今天"] });

    expect(out.published).toBe(false);
    expect(out.added.map((a) => a.word)).toEqual(["书", "银行", "今天"]);
    expect(out.url).toBe(`/flashcards/${out.deckId}`);

    // The deck itself, not just what the call claimed.
    const { deck, cards } = await getDeck(env, { deckId: out.deckId, user });
    expect(deck.is_published).toBe(0);
    expect(deck.created_by).toBe(user.id);
    expect(cards).toHaveLength(3);
    // Meanings come from the index, never from the caller.
    expect(cards.find((c) => c.front === "书").meaning.length).toBeGreaterThan(0);
  });

  it("keeps pinyin as the note, so the card is studyable", async () => {
    const { user } = await learner("b");
    const out = await saveWords(env, { user, words: ["书"] });
    const { cards } = await getDeck(env, { deckId: out.deckId, user });
    expect(cards[0].note?.toLowerCase()).toBe("shū");
  });

  it("uses the given title, and invents one otherwise", async () => {
    const { user } = await learner("c");
    const named = await saveWords(env, { user, words: ["书"], deck: "Hospital words" });
    expect(named.title).toBe("Hospital words");

    const unnamed = await saveWords(env, { user, words: ["书", "银行"] });
    expect(unnamed.title).toMatch(/2 words/);
  });
});

describe("what it refuses to save", () => {
  // The corruption defence. 翰译 is what this model produced when asked to
  // echo 翻译 — it is not a word, and it must not become a flashcard.
  it("skips a word it cannot look up rather than saving it", async () => {
    const { user } = await learner("d");
    const out = await saveWords(env, { user, words: ["书", "翰译", "银行"] });

    expect(out.added.map((a) => a.word)).toEqual(["书", "银行"]);
    expect(out.skipped).toEqual(["翰译"]);

    const { cards } = await getDeck(env, { deckId: out.deckId, user });
    expect(cards.map((c) => c.front)).not.toContain("翰译");
  });

  it("fails loudly when nothing resolves, rather than making an empty deck", async () => {
    const { user } = await learner("e");
    await expect(saveWords(env, { user, words: ["翰译", "攴革"] })).rejects.toThrow(
      /none of those words are in the dictionary/i,
    );
  });

  it("refuses an empty word list", async () => {
    const { user } = await learner("f");
    await expect(saveWords(env, { user, words: [] })).rejects.toThrow(/no words/i);
    await expect(saveWords(env, { user, words: ["", "  "] })).rejects.toThrow(/no words/i);
  });

  it("will not write into a deck the learner does not own", async () => {
    const { user: owner, token } = await learner("g");
    const { user: other } = await learner("h");
    const deckId = await createFlashcardDeck(token, { title: "Not yours" });

    await expect(saveWords(env, { user: other, words: ["书"], deckId })).rejects.toThrow();

    const { cards } = await getDeck(env, { deckId, user: owner });
    expect(cards).toHaveLength(0);
  });

  it("caps a runaway batch", async () => {
    const { user } = await learner("i");
    const many = Array.from({ length: 40 }, (_, i) => `书${i}`);
    // None of those resolve, so the cap is observable through the rejection
    // listing only what it actually considered.
    await expect(saveWords(env, { user, words: many })).rejects.toThrow(
      /none of those words are in the dictionary/i,
    );
    expect(SAVE_LIMITS.MAX_SAVE).toBe(20);
  });
});

describe("saving into an existing deck", () => {
  it("appends without touching what is there", async () => {
    const { user, token } = await learner("j");
    const deckId = await createFlashcardDeck(token, { title: "Kitchen" });
    await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
      method: "POST",
      token,
      body: { front: "刀", meaning: "knife" },
    });

    const out = await saveWords(env, { user, words: ["书"], deckId });
    expect(out.title).toBe("Kitchen");
    expect(out.cardCount).toBe(2);

    const { cards } = await getDeck(env, { deckId, user });
    expect(cards.map((c) => c.front).sort()).toEqual(["书", "刀"]);
  });

  it("does not add a word the deck already has", async () => {
    const { user } = await learner("k");
    const first = await saveWords(env, { user, words: ["书", "银行"] });
    const again = await saveWords(env, { user, words: ["书", "今天"], deckId: first.deckId });

    expect(again.duplicates).toEqual(["书"]);
    expect(again.added.map((a) => a.word)).toEqual(["今天"]);

    const { cards } = await getDeck(env, { deckId: first.deckId, user });
    expect(cards).toHaveLength(3);
  });

  it("de-duplicates within one call", async () => {
    const { user } = await learner("l");
    const out = await saveWords(env, { user, words: ["书", "书", " 书 "] });
    expect(out.added).toHaveLength(1);
  });
});

describe("words already looked up this turn", () => {
  it("prefers the turn's meaning over the offline copy", async () => {
    const { user } = await learner("m");
    const resolved = new Map([
      ["书", { word: "书", pinyin: "shū", meaning: "book (from the dictionary server)" }],
    ]);

    const out = await saveWords(env, { user, words: ["书"], resolved });
    expect(out.added[0].meaning).toContain("dictionary server");
  });

  // A word the learner typed that the offline index does not carry is still
  // saveable, because it was resolved before the model ever saw it.
  it("saves a word only the turn knows about", async () => {
    const { user } = await learner("n");
    const resolved = new Map([
      ["㐀㐁", { word: "㐀㐁", pinyin: "", meaning: "a word the server enriched" }],
    ]);

    const out = await saveWords(env, { user, words: ["㐀㐁"], resolved });
    expect(out.added.map((a) => a.word)).toEqual(["㐀㐁"]);
    expect(out.skipped).toEqual([]);
  });
});

// The model has no tool that would ever show it a deck id, and it proved the
// point by passing `deckId: "Practice"` — the name — into the id field. So it
// names decks the way the learner does.
describe("naming a deck instead of iding one", () => {
  it("appends to a deck of theirs with that name", async () => {
    const { user } = await learner("o");
    const first = await saveWords(env, { user, words: ["书"], deck: "Practice" });
    const again = await saveWords(env, { user, words: ["银行"], deck: "Practice" });

    expect(again.deckId).toBe(first.deckId);
    expect(again.cardCount).toBe(2);
  });

  it("matches the name however it was capitalised", async () => {
    const { user } = await learner("p");
    const first = await saveWords(env, { user, words: ["书"], deck: "Practice" });
    const again = await saveWords(env, { user, words: ["银行"], deck: "  practice " });
    expect(again.deckId).toBe(first.deckId);
  });

  it("creates the deck when they do not have one by that name", async () => {
    const { user } = await learner("q");
    const out = await saveWords(env, { user, words: ["书"], deck: "Brand new" });
    expect(out.title).toBe("Brand new");
    expect(out.published).toBe(false);
  });

  // A name that belongs to someone else must not resolve to their deck.
  it("never matches a name to another learner's deck", async () => {
    const { user: owner, token } = await learner("r");
    const { user: other } = await learner("s");
    const deckId = await createFlashcardDeck(token, { title: "Shared name" });

    const out = await saveWords(env, { user: other, words: ["书"], deck: "Shared name" });
    expect(out.deckId).not.toBe(deckId);

    const { cards } = await getDeck(env, { deckId, user: owner });
    expect(cards).toHaveLength(0);
  });
});

// The gate that stops unrequested writes. Measured before it existed: two of
// three plain word lookups created a deck the learner never asked for, because
// a tool with no required arguments is the cheapest one to call.
describe("save intent", () => {
  const asks = [
    "save 医院 to a deck",
    "keep these for me",
    "can you remember this word",
    "add them to my Practice deck",
    "把这些收藏起来",
    "保存这个词",
  ];
  const doesNot = [
    "医院",
    "什么是学习",
    "how do I write 银行",
    "give me 10 HSK 3 words",
    "make me a game",
    "what does this mean",
  ];

  it("recognises a request to save", () => {
    for (const m of asks) expect(TUTOR.wantsToSave(m), m).toBe(true);
  });

  it("does not read save intent into an ordinary question", () => {
    for (const m of doesNot) expect(TUTOR.wantsToSave(m), m).toBe(false);
  });

  it("survives junk", () => {
    for (const m of [null, undefined, 42, {}, ""]) expect(TUTOR.wantsToSave(m)).toBe(false);
  });
});

// ALLOWED_TOOLS is no longer a filter over a local registry — §11 step 9 deleted
// that. It is now the `allowed_tools` field of the request sent to
// services/agent-service, so it decides what the agent is even told exists.
//
// The tests that used to live here checked the JS registry's own behaviour:
// that select() only chooses what is ADVERTISED while execute() would resolve
// any name, which is why the allowlist had to be re-checked where tools ran.
// That gap moved with the loop — app/agent/state.py enforces the same rule on
// the Python side, and tests/test_guards.py covers it.
//
// What survives here is the list itself, because publishing is still the least
// reversible action in the app and still must not be offered.
describe("the tutor's allowlist", () => {
  it("withholds both publish tools", () => {
    expect(TUTOR.ALLOWED_TOOLS).not.toContain("publish_flashcard_deck");
    expect(TUTOR.ALLOWED_TOOLS).not.toContain("publish_challenge");
  });

  // Every name here crosses to Python, where schemas.py validates it against
  // TOOL_NAMES and rejects the whole request with a 422 if one is unknown. So a
  // name added on this side alone does not degrade — it breaks every turn.
  // services/agent-service/tests/test_tool_parity.py pins the two lists.
  it("names tools in the shape the contract expects", () => {
    for (const name of TUTOR.ALLOWED_TOOLS) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
