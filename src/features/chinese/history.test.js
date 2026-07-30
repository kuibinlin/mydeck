// What the tab sends back about earlier turns — and the parity between its caps
// and the worker's.
//
// Two copies exist for the same reason classify.js has two: the client has to
// decide what to send without asking anyone. The worker's `boundContext` is
// authoritative and re-applies every rule, so the risk is not that the client is
// too generous — it is that the two drift and the client quietly sends things
// the server throws away. This file imports both.

import { describe, it, expect } from "vitest";
import { buildContext } from "./history";
import { boundContext } from "../../../worker/src/services/zh/conversation.js";

const answered = (question, text, extra = {}) => ({
  question,
  error: null,
  result: { cards: [], agent: { text, activities: [], saves: [] }, ...extra },
});

describe("what becomes an exchange", () => {
  it("pairs the question with the reply", () => {
    const ctx = buildContext([answered("what does 书 mean", "书 means book.")]);
    expect(ctx.turns).toEqual([{ q: "what does 书 mean", a: "书 means book." }]);
  });

  it("skips turns that failed, went unanswered, or came back empty", () => {
    const ctx = buildContext([
      { question: "a", error: "offline", result: null },
      { question: "b", error: null, result: { agent: { unavailable: true, text: "" } } },
      answered("c", ""),
      answered("d", "kept"),
    ]);
    expect(ctx.turns).toEqual([{ q: "d", a: "kept" }]);
  });

  it("uses the server's prompt for an activity turn, which has no question", () => {
    const ctx = buildContext([
      answered(null, "Nice — six out of eight.", { prompt: "The learner scored 6/8." }),
    ]);
    expect(ctx.turns).toEqual([{ q: "The learner scored 6/8.", a: "Nice — six out of eight." }]);
  });

  it("keeps the last six", () => {
    const turns = Array.from({ length: 10 }, (_, i) => answered(`q${i}`, `a${i}`));
    const ctx = buildContext(turns);
    expect(ctx.turns).toHaveLength(6);
    expect(ctx.turns[0].q).toBe("q4");
  });
});

describe("the word ledger", () => {
  it("collects resolved card words and activity items", () => {
    const ctx = buildContext([
      {
        question: "书",
        error: null,
        result: {
          cards: [{ word: "书", found: true }, { word: "龘", found: false }],
          agent: { text: "ok", activities: [{ items: [{ word: "银行" }] }] },
        },
      },
    ]);
    expect(ctx.words).toEqual(["书", "银行"]);
  });

  it("keeps words from a turn whose reply failed", () => {
    // The lookup still happened and is still on screen, so it is still
    // something "save that" can mean.
    const ctx = buildContext([
      {
        question: "书",
        error: null,
        result: { cards: [{ word: "书", found: true }], agent: { unavailable: true, text: "" } },
      },
    ]);
    expect(ctx.turns).toEqual([]);
    expect(ctx.words).toEqual(["书"]);
  });

  it("dedupes and keeps at most twelve", () => {
    const turns = "一二三四五六七八九十百千万亿".split("").map((w) => ({
      question: w,
      error: null,
      result: { cards: [{ word: w, found: true }], agent: { text: "ok" } },
    }));
    const ctx = buildContext([...turns, ...turns]);
    expect(ctx.words).toHaveLength(12);
    expect(new Set(ctx.words).size).toBe(12);
  });

  it("survives an empty or absent transcript", () => {
    expect(buildContext([])).toEqual({ turns: [], words: [] });
    expect(buildContext(undefined)).toEqual({ turns: [], words: [] });
  });
});

describe("parity with the worker's bound", () => {
  it("sends nothing the server discards", () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({
      question: `question ${i}`,
      error: null,
      result: {
        cards: [{ word: "书", found: true }],
        agent: { text: `answer ${i}`, activities: [{ items: [{ word: "银行" }] }] },
      },
    }));

    const ctx = buildContext(turns);
    const bound = boundContext(ctx);

    // Every pair the client sends survives, in order, as alternating roles.
    expect(bound.history).toHaveLength(ctx.turns.length * 2);
    expect(bound.history.filter((m) => m.role === "user").map((m) => m.content)).toEqual(
      ctx.turns.map((t) => t.q),
    );
    expect(bound.words).toEqual(ctx.words);
  });
});
