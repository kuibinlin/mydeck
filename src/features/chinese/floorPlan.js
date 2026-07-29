// The instant floor: what to paint before anything has loaded.
//
// Runs on the same frame as the keystroke that submitted, using only the
// classification. No network, no model, no dictionary — so it cannot fail, and
// there is no state in this tab that is a spinner and nothing else.
//
// Two jobs. It puts something correct and readable on screen immediately, and
// it reserves the *right shape* for what is coming: a skeleton with ten rows
// when ten words were asked for, so the real answer never causes a reflow.

import { classify } from "./classify";

/**
 * @typedef {object} Floor
 * @property {string} kind          classification that produced this plan
 * @property {string[]} showChars   Han characters to render large, immediately
 * @property {"card"|"list"|"reader"|"none"} skeleton   shape to reserve
 * @property {number} skeletonRows  how many rows the skeleton holds
 * @property {string} status        honest one-liner while the rest arrives
 * @property {{label:string,send:string}[]} chips       always tappable
 * @property {boolean} needsServer  false means this is the whole answer
 */

// Asked-for count, so the skeleton reserves the right number of rows. "10 HSK 3
// words" must not paint three ghost rows and then reflow to ten.
function requestedCount(text) {
  const m = text.match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 30 ? n : null;
}

const CHIPS = {
  strokes: (w) => ({ label: `✎ write ${w}`, send: `show me how to write ${w}` }),
  level: (w) => ({ label: "HSK level", send: `what HSK level is ${w}` }),
  deck: (w) => ({ label: "+ add to a deck", send: `add ${w} to a deck` }),
  examples: (w) => ({ label: "in a sentence", send: `use ${w} in a sentence` }),
  hardWords: { label: "hard words only", send: "which words here are above my level?" },
  translate: { label: "translate it", send: "translate that for me" },
  startWords: { label: "HSK 1 words", send: "give me 10 HSK 1 words" },
  check: { label: "check my level", send: "check my level" },
};

/** @returns {Floor} */
export function floorPlan(input) {
  const c = classify(input);
  const word = c.text;

  switch (c.kind) {
    case "single_char":
      return {
        kind: c.kind,
        showChars: c.han,
        skeleton: "card",
        skeletonRows: 1,
        status: `Looking up ${word}…`,
        chips: [CHIPS.strokes(word), CHIPS.level(word), CHIPS.deck(word)],
        needsServer: true,
      };

    case "word":
      return {
        kind: c.kind,
        showChars: c.han,
        skeleton: "card",
        skeletonRows: 1,
        status: `Looking up ${word}…`,
        chips: [CHIPS.strokes(word), CHIPS.examples(word), CHIPS.deck(word)],
        needsServer: true,
      };

    case "phrase":
    case "sentence":
      return {
        kind: c.kind,
        showChars: c.han,
        skeleton: "list",
        skeletonRows: Math.min(6, c.hanCount),
        status: "Reading it…",
        chips: [CHIPS.hardWords, CHIPS.translate],
        needsServer: true,
      };

    case "paragraph":
      // Never the whole text: the eight rarest words is both the better answer
      // and the only one that does not fan out into hundreds of lookups.
      return {
        kind: c.kind,
        showChars: c.han.slice(0, 40),
        skeleton: "list",
        skeletonRows: 8,
        status: "Picking out the words worth learning…",
        chips: [CHIPS.hardWords, CHIPS.translate],
        needsServer: true,
      };

    case "mixed":
      return {
        kind: c.kind,
        showChars: c.han,
        skeleton: "card",
        skeletonRows: 1,
        status: "Reading the Chinese part…",
        chips: [CHIPS.hardWords],
        needsServer: true,
      };

    case "pinyin":
      return {
        kind: c.kind,
        showChars: [],
        skeleton: "list",
        skeletonRows: 4,
        status: `Finding words that sound like “${word}”…`,
        chips: [CHIPS.startWords],
        needsServer: true,
      };

    case "english": {
      const n = requestedCount(c.text);
      return {
        kind: c.kind,
        showChars: [],
        skeleton: n ? "list" : "none",
        skeletonRows: n ?? 0,
        status: n ? `Finding ${n} words…` : "Thinking…",
        chips: [],
        needsServer: true,
      };
    }

    case "foreign_cjk":
      // Declining is the honest answer, and it is instant. The dictionary that
      // makes this tab good is Chinese-only; guessing would be worse than "no".
      return {
        kind: c.kind,
        showChars: [],
        skeleton: "none",
        skeletonRows: 0,
        status: "I only do Chinese — words, characters, tones and practice.",
        chips: [CHIPS.startWords, CHIPS.check],
        needsServer: false,
      };

    // Something was typed, but there is nothing in it to look up — "123", "…",
    // an emoji. The blank status was written for the truly-empty box, which
    // never reaches here because the composer refuses to send it. Anything that
    // does reach here is a real submission and must get a real answer, or the
    // learner is left with an empty card that never resolves.
    default:
      return {
        kind: "empty",
        showChars: [],
        skeleton: "none",
        skeletonRows: 0,
        status: "I didn't find any Chinese in that. Try a word, a character, or paste a sentence.",
        chips: [CHIPS.startWords, CHIPS.check],
        needsServer: false,
      };
  }
}

export { requestedCount };
