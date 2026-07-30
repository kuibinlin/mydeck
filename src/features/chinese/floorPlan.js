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

// A chip is a next step the learner can take without composing a sentence.
//
// `label` is Chinese and `hint` is the English gloss — see Chip.jsx for why
// both. `send` stays English on purpose: it is the prompt, and the tutor
// answers in the language it is asked in. Someone pressing 造句 wants the
// example sentence in Chinese and the explanation of it in theirs.
//
// The labels say what the learner gets, not what the tab does internally. An
// earlier "hard words only" read as a filter toggle — something that would trim
// the answer already on screen — when it was only ever another question. It is
// gone; the words worth learning are already what a sentence lookup leads with
// (`hardestIn` in the worker ranks them, unprompted).
const CHIPS = {
  strokes: (w) => ({
    label: "✎ 写一写",
    hint: "write it",
    send: `show me how to write ${w}`,
  }),
  deck: (w) => ({
    label: "+ 加入卡组",
    hint: "add to a deck",
    // "save", not "add". The worker only offers the save tool when the message
    // reads as intent to keep something (SAVE_INTENT in services/tutor.js), and
    // "add 谢 to a deck" matches none of it — so this chip promised a write that
    // the model was never handed the means to perform.
    send: `save ${w} to a deck`,
  }),
  examples: (w) => ({
    label: "造句",
    hint: "in a sentence",
    send: `show me how to use ${w} in a sentence`,
  }),
  translate: { label: "翻译", hint: "translate it", send: "translate that for me" },
  startWords: { label: "HSK 1 生词", hint: "words to start", send: "give me 10 HSK 1 words" },
  check: { label: "我的水平", hint: "check my level", send: "check my level" },
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
        // Same three as `word`. There used to be an "HSK level" chip here, which
        // asked the tutor for the one fact the card underneath already prints on
        // a badge; 造句 is the thing the card cannot show.
        chips: [CHIPS.strokes(word), CHIPS.examples(word), CHIPS.deck(word)],
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
        chips: [CHIPS.translate],
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
        chips: [CHIPS.translate],
        needsServer: true,
      };

    // English wrapped around some Chinese — which is what every chip in this
    // file produces, so this is the class a learner lands in most: "show me how
    // to write 字" classifies here, not as `single_char`.
    //
    // No chips. The learner asked for one specific thing and is about to get a
    // stroke sheet or an example sentence; whatever is offered here is offered
    // *next to* that, and the word-level actions belong on the card, where they
    // know which word they mean.
    case "mixed":
      return {
        kind: c.kind,
        showChars: c.han,
        skeleton: "card",
        skeletonRows: 1,
        status: "Reading the Chinese part…",
        chips: [],
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

export { requestedCount, CHIPS };
