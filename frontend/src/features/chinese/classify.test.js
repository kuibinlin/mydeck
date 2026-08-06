// The classifier — and the parity between its two copies.
//
// This is the front door: it decides what the page paints before anything has
// loaded, and (server-side) what the tutor is asked to do. It exists twice
// because backend/ is a separate package, so this file imports both and fails
// the moment they disagree. Without it the duplication is a bug waiting to
// happen; with it, it's a copy with a contract.

import { describe, it, expect } from "vitest";
import { classify, KINDS } from "./classify";
import { classify as classifyWorker } from "../../../../backend/src/services/zh/classify.js";

// Every shape the tab actually receives, with the phrasing learners really use.
const CASES = [
  // single characters and words — the most common asks
  ["书", "single_char"],
  ["翻译", "word"],
  ["银行", "word"],
  ["中华人民", "word"],

  // longer Chinese
  ["我今天很忙但是明天有空", "phrase"],
  ["我今天很忙，因为我要去银行。", "sentence"],
  ["今天天气很好。我想去公园。", "paragraph"],

  // mixed script — the "改革 hsk?" pattern is extremely common
  ["改革 hsk?", "mixed"],
  ["what does 翻译 mean?", "mixed"],
  ["我今天很 happy", "mixed"],

  // English
  ["give me 10 HSK level 3 words", "english"],
  ["make me a game", "english"],
  ["how do you say recommend in chinese", "english"],

  // pinyin, typed rather than pasted
  ["nǐ hǎo", "pinyin"],
  ["hao3", "pinyin"],
  ["ni3 hao3", "pinyin"],

  // not Chinese
  ["こんにちは", "foreign_cjk"],
  ["한국어", "foreign_cjk"],
  ["日本語のテスト", "foreign_cjk"],

  // nothing
  ["", "empty"],
  ["   ", "empty"],
  ["…", "empty"],
];

describe("classify", () => {
  it.each(CASES)("%j → %s", (input, expected) => {
    expect(classify(input).kind).toBe(expected);
  });

  it("only ever returns a known kind", () => {
    for (const [input] of CASES) expect(KINDS).toContain(classify(input).kind);
  });

  it("extracts the Han characters, in order", () => {
    const out = classify("what does 翻译 mean?");
    expect(out.han).toEqual(["翻", "译"]);
    expect(out.hanCount).toBe(2);
    expect(out.hasLatin).toBe(true);
  });

  it("counts sentence terminators, full-width and half-width", () => {
    expect(classify("好。").terminators).toBe(1);
    expect(classify("好？真的吗！").terminators).toBe(2);
    expect(classify("really?").terminators).toBe(1);
  });

  it("trims before deciding, so trailing whitespace is not a paragraph", () => {
    expect(classify("  翻译  ").kind).toBe("word");
    expect(classify("  翻译  ").text).toBe("翻译");
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 42, {}, [], NaN]) {
      expect(() => classify(junk)).not.toThrow();
      expect(classify(junk).kind).toBe("empty");
    }
  });

  it("treats all-kanji Japanese as Chinese, because it is indistinguishable", () => {
    // 日本語 is three valid Han characters and a Chinese reader parses it. No
    // rule can separate this from Chinese, so it classifies as a word, misses
    // the HSK list, and lands on the honest "not in the vocabulary" path.
    // Pinned so nobody later "fixes" it into a false negative for real Chinese.
    expect(classify("日本語").kind).toBe("word");
    expect(classify("日本語のテスト").kind).toBe("foreign_cjk"); // kana present → detectable
  });

  it("does not mistake a long English sentence for a paragraph", () => {
    expect(classify("please give me some words that I can study today").kind).toBe("english");
  });
});

describe("parity between the client and worker copies", () => {
  it.each(CASES)("agree on %j", (input) => {
    expect(classifyWorker(input)).toEqual(classify(input));
  });

  it("agree on junk", () => {
    for (const junk of [null, undefined, 42, "", "   "]) {
      expect(classifyWorker(junk)).toEqual(classify(junk));
    }
  });

  it("agree across a generated sweep, not just the curated cases", () => {
    // The curated list is what someone thought to test. This crosses the
    // categories against each other to catch a divergence nobody predicted.
    const parts = ["书", "翻译", "hello", "3", "。", "ǎ", "こ", "  ", "?", "我今天很忙"];
    for (const a of parts) {
      for (const b of parts) {
        const input = a + b;
        expect(classifyWorker(input), `diverged on ${JSON.stringify(input)}`).toEqual(
          classify(input),
        );
      }
    }
  });
});
