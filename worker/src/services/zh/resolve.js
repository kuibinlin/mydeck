// Turning what the learner typed into word cards, deterministically.
//
// No model is involved. Every field here is dictionary data, which is the whole
// point: the model corrupts Chinese characters (measured: 3 of 7 echoed back
// wrong), so it must never be the source of a word, a tone, or a level.
//
// Two tiers, and the order matters:
//
//   bundle   localIndex.js, in the Worker itself. ~0ms, cannot fail, and covers
//            96% of headwords. This is what makes the floor unfailable.
//   server   the HSK MCP server. Richer — traditional form, radical, measure
//            word, real frequency rank — but it can be slow, down, or rate
//            limited.
//
// The bundle answers first and the server enriches. A server failure therefore
// downgrades the *detail* of a card, never its existence.

import { lookupLocal, hardestIn, wordsIn } from "./localIndex.js";
import { callTool } from "../../integrations/hskMcp.js";

// Hard ceiling on words resolved per turn, whatever was pasted. Without it a
// pasted article fans out into hundreds of calls and burns the shared rate
// budget for every other user in the same minute.
const MAX_WORDS = 8;

// Enrichment is optional by definition, so it gets a short leash. Past this the
// bundle card is already good enough to show.
const ENRICH_TIMEOUT_MS = 2500;

/**
 * A word card. `source` says which tier answered, so the UI can be honest and
 * the logs can show how often the server was actually reachable.
 *
 * @typedef {object} Card
 * @property {string} word
 * @property {string} pinyin
 * @property {string} meaning
 * @property {number|null} level
 * @property {boolean} found      false = genuinely not in the HSK vocabulary
 * @property {"bundle"|"server"|"none"} source
 * @property {string} [traditional]
 * @property {string} [radical]
 * @property {string[]} [classifiers]
 * @property {number} [frequencyRank]
 */

/** Trims the server's ~2 kB per-word payload to the ~200 bytes a card needs. */
function project(word, raw) {
  const hit = raw?.results?.[0];
  if (!hit) return null;

  const form = hit.forms?.[0] ?? {};
  return {
    word: hit.simplified ?? word,
    pinyin: form.pinyin ?? "",
    meaning: (form.meanings ?? [])[0] ?? "",
    level: hit.new_level ?? hit.old_level ?? null,
    found: true,
    source: "server",
    traditional: form.traditional || undefined,
    radical: hit.radical || undefined,
    classifiers: form.classifiers?.length ? form.classifiers : undefined,
    frequencyRank: hit.frequency_rank ?? undefined,
  };
}

function fromBundle(word) {
  const hit = lookupLocal(word);
  if (!hit) return null;
  return {
    word: hit.word,
    pinyin: hit.pinyin,
    meaning: hit.meaning,
    level: hit.level,
    found: true,
    source: "bundle",
  };
}

// A miss is a real answer, not a failure. It has to be said out loud so nothing
// downstream — a template or a model — fills the silence with an invention.
function notFound(word) {
  return { word, pinyin: "", meaning: "", level: null, found: false, source: "none" };
}

/**
 * One word, best available detail.
 *
 * Resolves even when everything upstream is broken: the worst case is a
 * `found: false` card, which is still a truthful thing to render.
 */
export async function resolveWord(env, word, { enrich = true } = {}) {
  const trimmed = typeof word === "string" ? word.trim() : "";
  if (!trimmed) return notFound("");

  const local = fromBundle(trimmed);
  if (!enrich) return local ?? notFound(trimmed);

  try {
    const raw = await withTimeout(
      callTool(env, "hsk_lookup", { word: trimmed }),
      ENRICH_TIMEOUT_MS,
    );
    const server = project(trimmed, raw);
    if (server) return server;

    // The server answered and had nothing. That is authoritative — but the
    // bundle is a subset of the same dataset, so a bundle hit here would mean
    // they disagree. Trust the server and say so.
    return local ?? notFound(trimmed);
  } catch {
    // Down, slow, or rate limited. The learner should not be able to tell.
    return local ?? notFound(trimmed);
  }
}

/**
 * The words worth resolving for a given input, already capped.
 *
 * For anything longer than a word this is the rare ones, ranked by the bundled
 * index — which costs no network call, so choosing *what* to look up is free
 * even when looking it up is not.
 */
export function candidates(classification, limit = MAX_WORDS) {
  const { kind, text, han } = classification;

  if (kind === "single_char" || kind === "word") return [text];
  // Chinese inside an English sentence. Usually one word being asked about —
  // "what does 医院 mean?" — so the joined form is tried first and wins when it
  // is real. When it is not, the learner named several: "看 听 说 — save these"
  // joined to 看听说, which is not a word, so nothing resolved and everything
  // downstream that reads the turn's words came up empty. Segment instead, and
  // keep their order.
  if (kind === "mixed") {
    if (!han.length) return [];
    const joined = han.join("");
    if (lookupLocal(joined)) return [joined];
    const found = wordsIn(text, limit).map((w) => w.word);
    return found.length ? found : han.slice(0, limit);
  }

  if (kind === "phrase" || kind === "sentence" || kind === "paragraph") {
    const hard = hardestIn(text, limit);
    // Nothing recognised — fall back to the individual characters so the
    // learner still gets something rather than an empty list.
    return hard.length ? hard.map((w) => w.word) : han.slice(0, limit);
  }

  return [];
}

/** Several words, resolved concurrently and capped. */
export async function resolveMany(env, words, { enrich = true } = {}) {
  const list = [...new Set(words)].filter(Boolean).slice(0, MAX_WORDS);
  return Promise.all(list.map((w) => resolveWord(env, w, { enrich })));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export const LIMITS = { MAX_WORDS, ENRICH_TIMEOUT_MS };
