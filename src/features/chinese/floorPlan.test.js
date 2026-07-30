// The chip table, and the one contract it has with the worker.
//
// Chips are how most turns actually get sent — the learner presses a button
// rather than composing a sentence — so a chip whose `send` string the worker
// reads differently from the way the label reads is a button that silently does
// nothing. That is not hypothetical: "+ add to a deck" sent "add 谢 to a deck",
// which matches none of the tutor's save-intent wording, so the save tool was
// never put on the table and the chip could not do what it said.
//
// So this file imports the worker's own predicate instead of restating it, the
// way classify.test.js pins the two copies of the classifier together.

import { describe, it, expect } from "vitest";
import { floorPlan, CHIPS } from "./floorPlan";
import { KINDS } from "./classify";
import { wantsToSave } from "../../../worker/src/services/tutor.js";

const HAN = /\p{Script=Han}/u;

// One input per classification, so every branch of the switch is walked.
const ONE_PER_KIND = [
  ["", "empty"],
  ["书", "single_char"],
  ["银行", "word"],
  ["我今天很忙但是明天有空", "phrase"],
  ["我今天很忙，因为我要去银行。", "sentence"],
  ["今天天气很好。我想去公园。", "paragraph"],
  ["nǐ hǎo", "pinyin"],
  ["give me 10 HSK 3 words", "english"],
  ["what does 翻译 mean?", "mixed"],
  ["日本語", "foreign_cjk"],
];

const everyChip = () => ONE_PER_KIND.flatMap(([input]) => floorPlan(input).chips);

describe("floorPlan chips", () => {
  it("covers every kind the classifier can produce", () => {
    // If a KIND is added without a case here, the switch default silently
    // catches it and this list stops being the coverage claim it looks like.
    const covered = new Set(ONE_PER_KIND.map(([, kind]) => kind));
    expect([...KINDS].filter((k) => !covered.has(k))).toEqual([]);
  });

  it("returns a chips array for every kind, never undefined", () => {
    for (const [input] of ONE_PER_KIND) {
      // AnswerBlock reads floor.chips.length unguarded.
      expect(Array.isArray(floorPlan(input).chips)).toBe(true);
    }
  });

  it("gives every chip a Chinese label, an English gloss and a prompt", () => {
    const chips = everyChip();
    expect(chips.length).toBeGreaterThan(0);

    for (const chip of chips) {
      // The label is the thing being learnt, so it is written in the language
      // being learnt; the gloss is what keeps that from being a guessing game.
      expect(chip.label, `label of ${chip.send}`).toMatch(HAN);
      expect(chip.hint, `hint of ${chip.send}`).toBeTruthy();
      expect(chip.hint, `hint of ${chip.send}`).not.toMatch(HAN);
      expect(chip.send?.trim(), `send of ${chip.label}`).toBeTruthy();
    }
  });
});

describe("chip prompts against the worker's save gate", () => {
  const word = "谢";

  it("arms the save tool for the chip that promises a save", () => {
    expect(wantsToSave(CHIPS.deck(word).send)).toBe(true);
  });

  it("leaves it disarmed for every chip that does not", () => {
    // Writing to someone's decks uninvited is the failure this gate exists to
    // prevent; a lookup chip that trips it is the same bug pointing the other
    // way, so both directions are pinned.
    const readOnly = [
      CHIPS.strokes(word),
      CHIPS.examples(word),
      CHIPS.translate,
      CHIPS.startWords,
      CHIPS.check,
    ];
    for (const chip of readOnly) {
      expect(wantsToSave(chip.send), `${chip.label} → ${chip.send}`).toBe(false);
    }
  });
});

describe("the practise-writing path", () => {
  // What EmptyState's "✎ practise writing it" and WordCard's 写一写 both send.
  // It reads as English to the classifier, which is the whole reason this used
  // to surface a chip about the learner's level next to a stroke sheet.
  const written = floorPlan("show me how to write 字");

  it("classifies as mixed, not single_char", () => {
    expect(written.kind).toBe("mixed");
  });

  it("offers no chips of its own", () => {
    expect(written.chips).toEqual([]);
  });

  it("still shows the character immediately", () => {
    expect(written.showChars).toEqual(["字"]);
    expect(written.needsServer).toBe(true);
  });
});

describe("no chip reads as a filter", () => {
  it("never offers to narrow the answer already on screen", () => {
    // "hard words only" read as a toggle that would trim what was rendered,
    // when it only ever asked another question. The words worth learning are
    // what a sentence lookup leads with anyway — hardestIn() ranks them in the
    // worker without being asked.
    for (const chip of everyChip()) {
      expect(chip.label.toLowerCase()).not.toContain("only");
      expect(chip.send.toLowerCase()).not.toContain("above my level");
    }
  });
});
