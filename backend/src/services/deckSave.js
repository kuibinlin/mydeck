// Turning a good practice round into something the learner keeps.
//
// This is the first tool that writes to the learner's own data, so two limits
// are structural rather than advisory.
//
// DRAFT ONLY. A new deck lands unpublished and this never publishes one.
// Publishing is the least reversible action in the app; it stays a human click
// on a page that shows exactly what is about to go public.
//
// EVERY WORD IS RESOLVED, NEVER TRANSCRIBED. The model names words; the
// characters, pinyin and meanings that reach the database come from the index
// or from what was already looked up this turn. Phase 0 measured this model
// corrupting 3 of 7 Chinese characters when echoing them into tool arguments —
// 翻译 became 翰译. A corrupted character does not resolve, so it is reported
// back as skipped instead of quietly becoming a flashcard the learner will
// study wrong for a month.

import { lookupLocal } from "./zh/localIndex.js";
import { createDeck, addCard, getDeck, listDecks } from "./flashcards.js";
import { badRequest } from "./errors.js";

const MAX_SAVE = 20;
const DEFAULT_CATEGORY = "Language";

/**
 * @param {Map<string, {word,pinyin,meaning,level}>} resolved
 *   Words already looked up this turn, keyed by the characters the learner
 *   actually typed. Checked before the index so a word the dictionary enriched
 *   saves with that meaning rather than the offline copy's.
 *
 * @returns {{
 *   deckId: number, title: string, url: string, published: false,
 *   added: {word:string, meaning:string}[], skipped: string[], duplicates: string[],
 *   cardCount: number,
 * }}
 */
export async function saveWords(env, { user, words, deckId, deck: deckName, resolved = new Map() }) {
  const wanted = unique(words).slice(0, MAX_SAVE);
  if (!wanted.length) throw badRequest("No words to save.");

  const found = [];
  const skipped = [];

  for (const word of wanted) {
    // Whichever source actually carries a meaning, not simply whichever exists.
    // `resolved.get(word) ?? lookupLocal(word)` falls back only when the entry
    // is missing — so a dictionary hit whose meanings came back empty won, and
    // the word was reported unresolvable while the offline index had a gloss
    // for it the whole time.
    const enriched = resolved.get(word);
    const hit = enriched?.meaning ? enriched : lookupLocal(word);
    if (hit?.meaning) found.push({ word, meaning: hit.meaning, pinyin: hit.pinyin ?? "" });
    else skipped.push(word);
  }

  // Actionable, because the model can act on it: the retry that works is the
  // one that stops transcribing characters. Failures are data — a message that
  // only says "no" wastes the step it costs.
  if (!found.length)
    throw badRequest(
      `None of those words are in the dictionary: ${skipped.join(", ")}. ` +
        "Those characters are wrong. Call save_words_to_deck again with NO `words` argument " +
        "to save the words already on screen.",
    );

  const deck = await destination(env, {
    user,
    deckId,
    deckName,
    count: found.length,
  });

  // A word already in the deck is not an error and not a second card. The
  // learner asking twice should get the same deck, not a duplicate pile.
  const have = new Set(deck.cards.map((c) => c.front));
  const duplicates = [];
  const added = [];

  for (const item of found) {
    if (have.has(item.word)) {
      duplicates.push(item.word);
      continue;
    }
    // The 50-card ceiling lives in addCard. Hitting it mid-batch means the
    // cards before it are already saved, so the deck is reported as it now
    // stands rather than the whole call failing and stranding them.
    try {
      await addCard(env, {
        deckId: deck.id,
        user,
        front: item.word,
        meaning: item.meaning,
        note: item.pinyin || null,
      });
      have.add(item.word);
      added.push({ word: item.word, meaning: item.meaning });
    } catch (err) {
      skipped.push(item.word);
      console.warn(`[deckSave] ${item.word} not added: ${err?.message ?? err}`);
    }
  }

  return {
    deckId: deck.id,
    title: deck.title,
    url: `/flashcards/${deck.id}`,
    published: false,
    added,
    skipped,
    duplicates,
    cardCount: deck.cards.length + added.length,
  };
}

/**
 * Which deck the words go into.
 *
 * A name, not an id. Phase 0 measured the model inventing a deck id it had
 * never seen; this phase measured it doing something more revealing — passing
 * `deckId: "Practice"`, the deck's *name*, into the id field. It had no way to
 * know an id and no tool that would ever show it one.
 *
 * So the model names a deck the way the learner does, and the name is resolved
 * here against decks they actually own. An unfamiliar name is not an error:
 * "save these to my Kitchen deck" should make Kitchen if it does not exist,
 * which is what the learner meant either way.
 */
async function destination(env, { user, deckId, deckName, count }) {
  if (deckId) return existing(env, { deckId, user });

  const name = String(deckName ?? "").trim().slice(0, 60);

  if (name) {
    const decks = await listDecks(env, { user });
    const match = decks.find(
      (d) => d.created_by === user.id && d.title.toLowerCase() === name.toLowerCase(),
    );
    if (match) return existing(env, { deckId: match.id, user });
  }

  return fresh(env, { user, name, count });
}

// An existing deck must be one the learner owns. getDeck already 404s a draft
// they cannot see; the ownership check is what stops an admin's tool call
// writing into somebody else's deck, which requireDeckOwner would allow.
async function existing(env, { deckId, user }) {
  const { deck, cards } = await getDeck(env, { deckId: Number(deckId), user });
  if (deck.created_by !== user.id) throw badRequest("That deck is not yours to add to.");
  return { id: deck.id, title: deck.title, cards };
}

async function fresh(env, { user, name: given, count }) {
  const name = given || `Chinese · ${count} words`;
  const { id } = await createDeck(env, {
    user,
    title: name,
    category: DEFAULT_CATEGORY,
    description: "Saved from the 中文 tutor.",
  });
  return { id, title: name, cards: [] };
}

function unique(words) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(words) ? words : []) {
    const word = String(raw ?? "").trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

export const SAVE_LIMITS = { MAX_SAVE };
