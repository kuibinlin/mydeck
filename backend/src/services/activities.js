// Building a practice activity the learner can actually use.
//
// The model names a type and, optionally, a source. Everything else is decided
// here — which is the point. Phase 0 measured the model inventing a deck id it
// had never seen (`{deckId: 1}` with no prior lookup), so the source is
// resolved server-side against what the learner really has.
//
// It also means "make me a game" is one tool call instead of two: no
// list-then-choose round trip, and no clarifying question, which the scenario
// review was emphatic about.

import { lookupLocal } from "./zh/localIndex.js";
import { wordList } from "./hsk.js";
import { listDecks, getDeck } from "./flashcards.js";
import { badRequest } from "./errors.js";

const MAX_ITEMS = 12;
const MIN_MATCH_ITEMS = 4;
// The longest thing that is still plausibly one word.
const MAX_WORD_CHARS = 8;

// Only what the writing widget can actually draw.
const HAN = /\p{Script=Han}/u;

/**
 * @returns {{
 *   id: string, type: "stroke"|"match", title: string,
 *   items: {word:string, pinyin:string, meaning:string}[],
 *   source: string,
 * }}
 */
export async function create(env, { user, type, words, deckId, level, title }) {
  if (type !== "stroke" && type !== "match")
    throw badRequest(`Unknown activity type: ${type}`);

  const { items, source } = await resolveSource(env, { user, words, deckId, level });

  const usable = type === "stroke" ? items.filter((i) => HAN.test(i.word)) : items;

  if (!usable.length)
    throw badRequest(
      type === "stroke"
        ? "No Chinese characters to practise writing."
        : "Nothing to build a game from.",
    );

  const validated = type === "match" ? forMatch(usable) : usable.slice(0, MAX_ITEMS);

  if (type === "match" && validated.length < MIN_MATCH_ITEMS)
    throw badRequest(
      `A matching game needs at least ${MIN_MATCH_ITEMS} words with distinct meanings.`,
    );

  return {
    id: crypto.randomUUID(),
    type,
    title: title?.slice(0, 60) || defaultTitle(type, source, validated.length),
    items: validated,
    source,
  };
}

/**
 * Where the words come from, in order of what the learner most likely meant.
 *
 * Explicit words win; then a named deck; then their most recent deck; then a
 * level-appropriate set. Never a question back to the learner.
 */
async function resolveSource(env, { user, words, deckId, level }) {
  if (Array.isArray(words) && words.length) {
    return { items: words.map(toItem).filter(Boolean), source: "words" };
  }

  if (deckId) {
    // getDeck enforces DRAFT VISIBILITY — not ownership. A published deck is
    // readable by anyone, which is the product working as intended: decks are
    // public content and building a practice round from one is a feature.
    // Someone else's *unpublished* deck 404s.
    //
    // Stated precisely because the earlier wording here claimed ownership, and
    // a false claim like that is how a real hole gets built later: the next
    // person to add a write path beside this read sees "ownership is handled"
    // and skips the check that a write actually needs. deckSave.js does its own
    // `created_by !== user.id` test for exactly that reason.
    const deck = await getDeck(env, { deckId: Number(deckId), user });
    return { items: fromCards(deck.cards), source: `deck:${deck.deck.title}` };
  }

  const decks = await listDecks(env, { user });
  const own = decks.filter((d) => d.created_by === user.id && d.card_count > 0);
  if (own.length) {
    const newest = own[0];
    const deck = await getDeck(env, { deckId: newest.id, user });
    return { items: fromCards(deck.cards), source: `deck:${deck.deck.title}` };
  }

  const lv = Number(level) || 1;
  const list = await wordList(env, { level: lv, limit: MAX_ITEMS });
  return {
    items: list.words.map((w) => ({ word: w.w, pinyin: w.py, meaning: w.en })),
    source: `HSK ${lv}`,
  };
}

function toItem(word) {
  const w = String(word ?? "").trim();
  if (!w) return null;
  const hit = lookupLocal(w);
  return { word: w, pinyin: hit?.pinyin ?? "", meaning: hit?.meaning ?? "" };
}

function fromCards(cards) {
  return (cards ?? [])
    .map((c) => ({ word: c.front, pinyin: "", meaning: c.meaning }))
    .filter((i) => i.word && i.meaning);
}

/**
 * A matching game is only playable if every answer is unambiguous.
 *
 * Two words sharing a meaning make the round unwinnable — the learner picks a
 * correct answer and is marked wrong. Blank meanings are equally unplayable.
 * Both are dropped here rather than discovered mid-game.
 */
function forMatch(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = normalise(item.meaning);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length === MAX_ITEMS) break;
  }

  return out;
}

const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/^(to |a |an |the )/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Turns a finished activity into the sentence the model reads.
 *
 * Two rules make this safe, and both matter:
 *
 * 1. The server writes the prose, from the numbers. The client never supplies
 *    text that reaches a prompt.
 * 2. Misses are clamped to the activity's own word list. Without that, a
 *    crafted POST could put arbitrary text into a context where tools run —
 *    the newest door into exactly the injection reach the tool allowlist
 *    exists to limit. After clamping, the client's influence is a subset of a
 *    set this server produced, plus three integers.
 */
export function summariseResult(activity, data) {
  // Activities are not persisted — they are minted in memory and handed to the
  // client, which posts one back when it finishes. So `activity` is attacker-
  // controlled too, and checking `misses` against `activity.items` was circular:
  // a crafted POST supplies both the list and the allowlist it is checked
  // against. Membership is therefore necessary but nowhere near sufficient.
  //
  // What actually bounds this is the SHAPE. A word is Han characters, and a
  // short run of them. Text that is not that never reaches the prompt, so the
  // client's influence is at most twelve short Chinese words plus three
  // integers — regardless of what it claims the activity contained.
  const items = Array.isArray(activity?.items) ? activity.items : [];
  const known = new Set(items.map((i) => String(i?.word ?? "").trim()).filter(Boolean));

  const total = clampInt(data?.total, 0, LIMITS.MAX_ITEMS);
  const correct = clampInt(data?.correct, 0, total);
  const seconds = clampInt(data?.seconds, 0, 3600);

  const misses = (Array.isArray(data?.misses) ? data.misses : [])
    .map((m) => String(m?.word ?? "").trim())
    .filter((w) => known.has(w) && isWord(w))
    .slice(0, LIMITS.MAX_ITEMS);

  if (activity?.type === "stroke") {
    const completed = clampInt(data?.completed, 0, total);
    return {
      text: `The learner finished writing practice: ${completed} of ${total} characters traced.`,
      misses: [],
      score: { total, completed },
    };
  }

  // The title used to be interpolated here. It came from the request body with
  // no cap and no filter, which made it a second door of exactly the kind the
  // clamp above exists to close — and the model never needed it.
  const missText = misses.length ? ` They missed: ${misses.join(", ")}.` : "";
  return {
    text:
      `The learner just finished a quick check: ` +
      `${correct} of ${total} correct in ${seconds} seconds.${missText}`,
    misses,
    score: { total, correct, seconds },
  };
}

// A Chinese word: Han characters only, and few enough to be one. Nothing that
// fails this can carry an instruction.
const isWord = (w) => w.length <= MAX_WORD_CHARS && /^\p{Script=Han}+$/u.test(w);

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function defaultTitle(type, source, n) {
  const what = type === "stroke" ? "Writing practice" : "Quick check";
  return `${what} · ${n} word${n === 1 ? "" : "s"}${source.startsWith("deck:") ? ` from ${source.slice(5)}` : ""}`;
}

export const LIMITS = { MAX_ITEMS, MIN_MATCH_ITEMS };
