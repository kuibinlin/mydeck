// The offline index. No network, no binding — this is the rung that cannot fail,
// so its job is to be correct and to stay small.

import { describe, it, expect } from "vitest";
import { lookupLocal, hardestIn, wordsIn, meta } from "../src/services/zh/localIndex.js";

describe("the bundled index", () => {
  it("carries the dataset it was generated from", () => {
    expect(meta.datasetVersion).toBe("2026-04-11");
  });

  it("covers ~96% of upstream headwords", () => {
    // The shortfall is words carried solely by the old HSK 2.0 scheme, which
    // have no 3.0 level to be listed under. Bounded and expected; a drop here
    // means the export broke or the upstream dataset moved.
    expect(meta.total).toBeGreaterThan(10500);
    expect(meta.coverage).toBeGreaterThan(0.95);
  });
});

describe("lookupLocal", () => {
  it("finds a common word with pinyin, meaning and level", () => {
    const out = lookupLocal("书");
    expect(out.pinyin.toLowerCase()).toBe("shū");
    expect(out.level).toBe(1);
    expect(out.meaning.length).toBeGreaterThan(0);
    expect(out.source).toBe("bundle");
  });

  it("finds a multi-character word", () => {
    const out = lookupLocal("银行");
    expect(out.level).toBe(2);
    expect(out.pinyin.toLowerCase()).toBe("yín háng");
  });

  it("passes upstream pinyin through unchanged, capitalisation included", () => {
    // 1.7% of entries arrive capitalised. Some of that is correct — 中国 is
    // Zhōngguó — and some is not: 书 comes through as "Shū". They cannot be
    // told apart, and lower-casing everything would break the proper nouns.
    //
    // So this tier reports exactly what the dictionary says. A fallback that
    // silently disagrees with the live server is worse than a capital letter,
    // and display casing is a rendering decision, not a data one.
    expect(lookupLocal("中国").pinyin).toBe("Zhōng guó");
    expect(lookupLocal("书").pinyin).toBe("Shū");
  });

  it("has no entry for 你好 — it is two headwords, not one", () => {
    // Worth pinning: the most famous phrase in Chinese is absent, because the
    // dataset indexes headwords. hardestIn() finds 你 and 好 separately, which
    // is why segmentation cannot assume a phrase lookup will hit.
    expect(lookupLocal("你好")).toBeNull();
    expect(lookupLocal("你")).not.toBeNull();
    expect(lookupLocal("好")).not.toBeNull();
  });

  it("assigns a word to its lowest level when it appears at several", () => {
    // Levels are walked ascending and first wins, so this can never regress to
    // reporting an advanced level for a beginner word.
    const out = lookupLocal("的");
    expect(out.level).toBe(1);
  });

  it("returns null for a word outside the list, rather than guessing", () => {
    // This is the signal that stops a model inventing a definition.
    expect(lookupLocal("学霸")).toBeNull();
    expect(lookupLocal("zzzqqq")).toBeNull();
  });

  it("survives junk input", () => {
    expect(lookupLocal("")).toBeNull();
    expect(lookupLocal(null)).toBeNull();
    expect(lookupLocal(undefined)).toBeNull();
    expect(lookupLocal(42)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(lookupLocal("  书  ")?.word).toBe("书");
  });
});

describe("hardestIn — a pasted paragraph, with zero network calls", () => {
  const sentence = "我今天很忙，因为我要去银行办理一些手续。";

  it("finds words in the text", () => {
    const out = hardestIn(sentence);
    expect(out.length).toBeGreaterThan(0);
    const words = out.map((w) => w.word);
    expect(words.some((w) => sentence.includes(w))).toBe(true);
  });

  it("prefers the longest match, so 银行 wins over 银 and 行", () => {
    const words = hardestIn("我去银行", 8).map((w) => w.word);
    expect(words).toContain("银行");
    expect(words).not.toContain("银");
  });

  it("returns hardest first", () => {
    const out = hardestIn(sentence, 8);
    const ranks = out.map((w) => w.rank);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it("honours the limit, so a long paste cannot fan out", () => {
    const long = "我今天很忙因为我要去银行办理一些手续然后回家吃饭休息".repeat(20);
    expect(hardestIn(long, 8).length).toBeLessThanOrEqual(8);
  });

  it("returns nothing for text with no Chinese", () => {
    expect(hardestIn("hello world")).toEqual([]);
  });

  it("survives junk input", () => {
    expect(hardestIn(null)).toEqual([]);
    expect(hardestIn(undefined)).toEqual([]);
  });
});

// Same scan as hardestIn, different ordering. This is what answers "which
// words did the learner name", so order is the whole point.
describe("wordsIn", () => {
  it("keeps the order they were written in", () => {
    const out = wordsIn("看 听 说").map((w) => w.word);
    expect(out).toEqual(["看", "听", "说"]);
  });

  it("prefers the longer word at each position", () => {
    const out = wordsIn("我去银行").map((w) => w.word);
    expect(out).toContain("银行");
    expect(out).not.toContain("银");
  });

  it("finds Chinese embedded in English", () => {
    const out = wordsIn("I want to visit 医院 tomorrow").map((w) => w.word);
    expect(out).toContain("医院");
  });

  it("honours the limit and survives junk", () => {
    expect(wordsIn("我今天很忙因为我要去银行办理手续".repeat(20), 5).length).toBeLessThanOrEqual(5);
    expect(wordsIn(null)).toEqual([]);
    expect(wordsIn("hello world")).toEqual([]);
  });
});
