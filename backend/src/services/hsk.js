// HSK vocabulary, shaped for a model to read.
//
// Everything here projects hard before returning. Measured on the live server:
// one `hsk_build_study_set` reply is 27 kB — roughly 7,000 tokens for twenty
// words. Two of those and a 70B model's context is gone, so projection is a
// correctness requirement, not a size optimisation.
//
// Projected, a twenty-word list is about 1.1 kB. The dropped fields — Wade-Giles,
// Bopomofo, Romatzyh, rarity class, meanings past the first — are a real
// capability being given up, and the right way to get them back is a dedicated
// tool, not a wider default.

import { callTool } from "../integrations/hskMcp.js";
import { lookupLocal } from "./zh/localIndex.js";
import { badRequest } from "./errors.js";

/** One word, richest available. Falls back to the bundled index. */
export async function lookup(env, { word }) {
  const trimmed = typeof word === "string" ? word.trim() : "";
  if (!trimmed) throw badRequest("A word is required");

  try {
    const raw = await callTool(env, "hsk_lookup", { word: trimmed });
    const hit = raw?.results?.[0];

    if (!hit) {
      // Said out loud, deliberately. A model handed an empty array invents a
      // definition; a model told "not in the dataset" says so.
      return {
        word: trimmed,
        found: false,
        note: "Not in the HSK vocabulary list. Say so plainly — do not invent a meaning, level or frequency.",
      };
    }

    const form = hit.forms?.[0] ?? {};
    return {
      word: hit.simplified ?? trimmed,
      found: true,
      pinyin: form.pinyin ?? "",
      meanings: (form.meanings ?? []).slice(0, 3),
      level: hit.new_level ?? hit.old_level ?? null,
      frequencyRank: hit.frequency_rank ?? null,
      traditional: form.traditional || undefined,
      radical: hit.radical || undefined,
      classifiers: form.classifiers?.length ? form.classifiers.slice(0, 3) : undefined,
    };
  } catch {
    const local = lookupLocal(trimmed);
    if (local) {
      return {
        word: local.word,
        found: true,
        pinyin: local.pinyin,
        meanings: [local.meaning],
        level: local.level,
        partial: "Offline copy — no traditional form, radical or measure word.",
      };
    }
    return { word: trimmed, found: false, note: "Dictionary unavailable and not in the offline list." };
  }
}

/**
 * A level's vocabulary, most frequent first.
 *
 * `known` turns this into a recommendation rather than a list, which is the
 * difference between "here are HSK 4 words" and "here are the ones you don't
 * have yet" — and the second is what makes the tab feel personal.
 */
export async function wordList(env, { level, limit = 10, known = [], scheme = "new" }) {
  const lv = Number(level);
  if (!Number.isFinite(lv) || lv < 1 || lv > 7) throw badRequest("Level must be 1-7");

  const want = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const exclude = new Set((Array.isArray(known) ? known : []).map((w) => String(w).trim()));

  const tool = exclude.size ? "hsk_suggest_next" : "hsk_build_study_set";
  const args = exclude.size
    ? { level: lv, scheme, known: [...exclude] }
    : { level: lv, scheme };

  const raw = await callTool(env, tool, args);
  const words = raw?.words ?? raw?.results ?? [];

  const projected = words
    .filter((w) => w?.simplified && !exclude.has(w.simplified))
    .slice(0, want)
    .map((w) => ({
      w: w.simplified,
      py: w.forms?.[0]?.pinyin ?? w.pinyin ?? "",
      en: (w.forms?.[0]?.meanings ?? w.meanings ?? [])[0] ?? "",
      lv: w.new_level ?? lv,
    }));

  return { level: lv, count: projected.length, words: projected };
}

/** English meaning to Chinese words. */
export async function search(env, { query, limit = 6 }) {
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) throw badRequest("A search term is required");

  const raw = await callTool(env, "hsk_search_meaning", { query: q });
  const results = raw?.results ?? [];

  return {
    query: q,
    words: results.slice(0, Math.min(Number(limit) || 6, 10)).map((r) => ({
      w: r.simplified,
      py: r.forms?.[0]?.pinyin ?? "",
      en: (r.forms?.[0]?.meanings ?? [])[0] ?? "",
      lv: r.new_level ?? null,
    })),
  };
}
