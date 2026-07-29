// The tutor turn endpoint.
//
// The property under test is the one the whole design rests on: a learner
// always gets a truthful answer. The dictionary can be down, rate limited, or
// simply not know the word, and the response still carries something correct.
//
// The canned HSK reply in vitest.config.mjs knows 书 and nothing else, so a
// card sourced "server" proves enrichment ran, any other real word exercises
// the bundle tier, and a word in neither exercises the miss path.

import { describe, it, expect } from "vitest";
import { requestJson, createUserWithSession } from "./helpers";
import { classify } from "../src/services/zh/classify.js";
import { candidates } from "../src/services/zh/resolve.js";

const user = () =>
  createUserWithSession({ email: "learner@example.com", username: "learner" });

const turn = (token, message) =>
  requestJson("/api/zh/turn", { method: "POST", token, body: { message } });

describe("auth", () => {
  it("401s without a session", async () => {
    const { status } = await turn(null, "翻译");
    expect(status).toBe(401);
  });
});

describe("a word gets a card", () => {
  it("returns a card with pinyin, meaning and level", async () => {
    const { token } = await user();
    const { status, data } = await turn(token, "书");

    expect(status).toBe(200);
    expect(data.kind).toBe("single_char");
    expect(data.cards).toHaveLength(1);

    const card = data.cards[0];
    expect(card.found).toBe(true);
    expect(card.pinyin.toLowerCase()).toBe("shū");
    expect(card.level).toBe(1);
    expect(card.meaning.length).toBeGreaterThan(0);
  });

  it("reports which tier answered", async () => {
    const { token } = await user();
    const { data } = await turn(token, "书");
    expect(["bundle", "server"]).toContain(data.cards[0].source);
    expect(data.sources).toContain(data.cards[0].source);
  });

  it("stamps the dataset version, so a stale bundle is visible", async () => {
    const { token } = await user();
    const { data } = await turn(token, "书");
    expect(data.dataset).toBe("2026-04-11");
  });

  // The test config has no [ai] binding, so the tutor cannot run here. That
  // makes this the cheapest possible proof of the property the whole design
  // rests on: with the model completely unavailable, the answer is still
  // complete and still 200. Nothing about the card changes.
  it("returns a full answer when the tutor is unavailable", async () => {
    const { token } = await user();
    const { status, data } = await turn(token, "书");

    expect(status).toBe(200);
    expect(data.agent.unavailable).toBe(true);
    expect(data.cards[0].found).toBe(true);
    expect(data.cards[0].pinyin.toLowerCase()).toBe("shū");
  });

  it("never surfaces the model's failure as an error status", async () => {
    const { token } = await user();
    const { status } = await turn(token, "翻译");
    expect(status).toBe(200);
  });
});

describe("a sentence gets the words worth learning", () => {
  it("picks words out of the sentence rather than returning the whole thing", async () => {
    const { token } = await user();
    const { data } = await turn(token, "我今天很忙，因为我要去银行。");

    expect(data.kind).toBe("sentence");
    expect(data.cards.length).toBeGreaterThan(1);
    for (const c of data.cards) expect(c.word.length).toBeLessThanOrEqual(4);
  });

  it("caps the fan-out, so a pasted article cannot drain the rate budget", async () => {
    const { token } = await user();
    const long = "我今天很忙因为我要去银行办理一些手续然后回家吃饭休息".repeat(20);
    const { data } = await turn(token, long);

    expect(data.kind).toBe("paragraph");
    expect(data.cards.length).toBeLessThanOrEqual(8);
  });
});

describe("answers that need nothing at all", () => {
  it("declines other languages instantly, with no lookup", async () => {
    const { token } = await user();
    const { status, data } = await turn(token, "한국어");

    expect(status).toBe(200);
    expect(data.kind).toBe("foreign_cjk");
    expect(data.cards).toEqual([]);
  });

  it("handles an empty message without erroring", async () => {
    const { token } = await user();
    const { status, data } = await turn(token, "   ");
    expect(status).toBe(200);
    expect(data.kind).toBe("empty");
    expect(data.cards).toEqual([]);
  });

  it("handles a missing message field", async () => {
    const { token } = await user();
    const { status, data } = await requestJson("/api/zh/turn", {
      method: "POST",
      token,
      body: {},
    });
    expect(status).toBe(200);
    expect(data.kind).toBe("empty");
  });
});

describe("a word outside the vocabulary", () => {
  it("says so rather than returning something invented", async () => {
    const { token } = await user();
    // 龘 is a real character and definitively not HSK vocabulary.
    const { data } = await turn(token, "龘");

    const card = data.cards[0];
    // Unconditional on purpose. This was once wrapped in `if (card.word ===
    // "龘")`, which never held: the canned reply answered 书 for every word and
    // project() takes the word from the server's `simplified`, so the card came
    // back labelled 书 and the whole body was skipped. A test that reports a
    // pass without running its assertions is worse than no test.
    expect(card.word).toBe("龘");
    expect(card.found).toBe(false);
    expect(card.meaning).toBe("");
    expect(card.source).toBe("none");
  });

  // The other half of the same property: the server saying "no results" must
  // not be swallowed into a card built from whatever the *previous* word was.
  it("keeps the answer about the word that was asked", async () => {
    const { token } = await user();
    const { data } = await turn(token, "书");
    expect(data.cards[0].word).toBe("书");
    expect(data.cards[0].found).toBe(true);
  });
});

describe("quota", () => {
  it("does not spend an AI generation — lookups must work at zero balance", async () => {
    const { user: u, token } = await user();
    await turn(token, "书");

    const { n } = await requestJson("/api/ai/settings", { token }).then((r) => ({
      n: r.data.usage.used,
    }));
    expect(n).toBe(0);
    expect(u.id).toBeDefined();
  });
});

// The mixed branch decides what a whole turn knows about. It came back empty
// for "看 听 说 — save these", because every Han character was joined into one
// string that is not a word — and everything downstream that reads the turn's
// words, including saving to a deck, silently had nothing to work with.
describe("Chinese inside an English sentence", () => {
  it("treats contiguous characters as the one word being asked about", () => {
    expect(candidates(classify("what does 医院 mean?"))).toEqual(["医院"]);
  });

  it("segments when the learner names several words", () => {
    expect(candidates(classify("看 听 说 — save these three for me"))).toEqual([
      "看",
      "听",
      "说",
    ]);
  });

  it("keeps working when the joined form is not a word", () => {
    const out = candidates(classify("I like 中国 and 日本 food"));
    expect(out).toContain("中国");
    expect(out).not.toContain("中国日本");
  });

  it("falls back to bare characters when nothing segments", () => {
    const out = candidates(classify("look at 㐀 here"));
    expect(out).toEqual(["㐀"]);
  });
});
