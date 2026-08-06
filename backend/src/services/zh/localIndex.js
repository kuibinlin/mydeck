// The offline word index — the rung below the dictionary.
//
// When the HSK server is unreachable, or its rate ceiling is binding, this is
// what still puts a correct card on screen. It is a plain JSON import, so it is
// part of the Worker bundle: no network, no binding, no failure mode.
//
// Narrower than the live server on purpose. One meaning, no radical, no
// classifier, no traditional form, no transcriptions beyond pinyin. Anything
// richer is a reason to call the server, not a reason to grow this file.
//
// Regenerate with: npm run hsk:index

import data from "./data/hsk-core.json";

// Built once per isolate, on first use rather than at import, so a request that
// never touches Chinese does not pay for it.
let byWord = null;

function index() {
  if (byWord) return byWord;

  byWord = new Map();
  for (const [level, rows] of Object.entries(data.levels)) {
    const lv = Number(level);
    rows.forEach(([simplified, pinyin, meaning], i) => {
      // First wins: a word appearing at two levels belongs to the lower one,
      // and levels are walked in ascending order.
      if (byWord.has(simplified)) return;
      byWord.set(simplified, {
        word: simplified,
        pinyin,
        meaning,
        level: lv,
        // Position within a level is frequency order, so (level, index) is a
        // usable global ordering. Approximate — it is not the server's rank.
        rank: lv * 10000 + i,
        source: "bundle",
      });
    });
  }
  return byWord;
}

// One word. Returns null when absent — callers must say "not in the HSK list"
// rather than let a model invent a definition for it.
export function lookupLocal(word) {
  if (typeof word !== "string" || !word) return null;
  return index().get(word.trim()) ?? null;
}

// Every word in the text that this index knows, hardest first.
//
// This is how a pasted paragraph gets useful without a single network call:
// rank the words it contains and surface the rare ones. Longest match wins, so
// 银行 is found before 银 and 行.
/**
 * Longest-match segmentation, in the order the words appear.
 *
 * "Which words did the learner name?" — so 看 听 说 comes back as three words
 * the way they wrote them, not reordered by difficulty.
 */
export function wordsIn(text, limit = 8) {
  if (typeof text !== "string") return [];
  const map = index();
  const found = new Map();

  for (let i = 0; i < text.length; i++) {
    for (let len = Math.min(4, text.length - i); len >= 1; len--) {
      const candidate = text.slice(i, i + len);
      const hit = map.get(candidate);
      if (hit) {
        if (!found.has(candidate)) found.set(candidate, hit);
        i += len - 1;
        break;
      }
    }
  }

  return [...found.values()].slice(0, limit);
}

/**
 * The same words, hardest first — what a lesson should lead with when the
 * learner pasted a whole paragraph and cannot be shown all of it.
 */
export function hardestIn(text, limit = 8) {
  return wordsIn(text, Infinity)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}

export const meta = {
  datasetVersion: data.dataset_version,
  total: data.total,
  coverage: data.coverage,
};
