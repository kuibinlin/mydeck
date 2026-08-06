// What did the learner just type?
//
// A pure function, ~1ms, no imports. It runs before anything else so the page
// can paint a useful first frame with zero network calls — see floorPlan.js.
//
// The worker will need this same logic in phase 3 to decide server-side. When
// that copy lands it becomes authoritative and this one keeps its job of
// painting the first frame; a parity test must pin the two together.
//
// Deliberately not a segmenter. It answers "what shape is this input", not
// "what are the words" — segmentation needs a dictionary, and the whole point
// of this layer is that it needs nothing.

const HAN = /\p{Script=Han}/u;
const HAN_G = /\p{Script=Han}/gu;
const KANA = /[぀-ヿ]/u;
const HANGUL = /[가-힯]/u;
const LATIN = /[a-zA-Z]/;
const TONE_MARK = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;
const NUMBERED = /^[a-zü]{1,6}[1-5]$/i;
const TERMINATOR = /[。！？!?]/gu;

export const KINDS = /** @type {const} */ ([
  "empty",
  "single_char",
  "word",
  "phrase",
  "sentence",
  "paragraph",
  "pinyin",
  "english",
  "mixed",
  "foreign_cjk",
]);

/**
 * @param {string} input
 * @returns {{
 *   kind: typeof KINDS[number],
 *   text: string,
 *   han: string[],
 *   hanCount: number,
 *   terminators: number,
 *   hasLatin: boolean,
 * }}
 */
export function classify(input) {
  const text = typeof input === "string" ? input.trim() : "";
  const han = text.match(HAN_G) ?? [];
  const terminators = (text.match(TERMINATOR) ?? []).length;
  const hasLatin = LATIN.test(text);

  const base = { text, han, hanCount: han.length, terminators, hasLatin };

  if (!text) return { ...base, kind: "empty" };

  // Japanese kana or Korean hangul — the only reliable signal that this is not
  // Chinese.
  //
  // Text written purely in kanji cannot be detected here, and no rule can fix
  // that: 日本語 is three valid Han characters and a Chinese reader parses it
  // fine. Such input classifies as `word`, gets looked up, misses the HSK list,
  // and lands on the honest "not in the vocabulary list — here is the stroke
  // order anyway" path. That is the right outcome, so this is a boundary of the
  // classifier rather than a gap in it.
  if (KANA.test(text) || HANGUL.test(text)) return { ...base, kind: "foreign_cjk" };

  if (!HAN.test(text)) {
    // Pinyin the learner typed rather than pasted: nǐ hǎo, or hao3.
    const looksPinyin =
      TONE_MARK.test(text) || text.split(/\s+/).every((t) => NUMBERED.test(t));
    if (looksPinyin) return { ...base, kind: "pinyin" };
    if (hasLatin) return { ...base, kind: "english" };
    return { ...base, kind: "empty" };
  }

  // Han present. Mixed script gets its own class so the caller can operate on
  // the Chinese part without pretending the English half was understood.
  if (hasLatin) return { ...base, kind: "mixed" };

  if (han.length > 80 || terminators > 1) return { ...base, kind: "paragraph" };
  if (terminators === 1) return { ...base, kind: "sentence" };
  if (han.length === 1) return { ...base, kind: "single_char" };
  if (han.length <= 4) return { ...base, kind: "word" };
  return { ...base, kind: "phrase" };
}
