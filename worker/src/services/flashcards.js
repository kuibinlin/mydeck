// Flashcard deck and card operations.
//
// Every function takes (env, args) and returns plain data or throws an
// AppError. No Request, no Response, no CORS — that is the HTTP layer's job.

import { badRequest, forbidden, notFound } from "./errors.js";
import {
  isAdmin,
  canSeeDraft,
  requireDeckOwner,
  deckTable,
  DECK_KIND,
} from "./access.js";
import { MIN_ITEMS_TO_PUBLISH } from "./constants.js";

// Ownership checks name the kind; the table for our own queries is derived
// from it, so the two can never point at different tables.
const KIND = DECK_KIND.FLASHCARD;
const TABLE = deckTable(KIND);

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 500;
const MAX_FRONT = 500;
const MAX_MEANING = 2000;
const MAX_NOTE = 2000;

function assertDeckFields({ title, description }) {
  if (title && title.length > MAX_TITLE)
    throw badRequest(`Title too long (max ${MAX_TITLE} chars)`);
  if (description && description.length > MAX_DESCRIPTION)
    throw badRequest(`Description too long (max ${MAX_DESCRIPTION} chars)`);
}

function assertCardFields({ front, meaning, note }) {
  if (front && front.length > MAX_FRONT)
    throw badRequest(`Front too long (max ${MAX_FRONT} chars)`);
  if (meaning && meaning.length > MAX_MEANING)
    throw badRequest(`Meaning too long (max ${MAX_MEANING} chars)`);
  if (note && note.length > MAX_NOTE)
    throw badRequest(`Note too long (max ${MAX_NOTE} chars)`);
}

// Drafts are visible only to the user who owns them.
//
// This is a relevance filter, not a permission check — admins are filtered too,
// deliberately. An admin moderating the site does not want every half-finished
// deck in their list, and they can still open, edit or delete any deck by id.
export async function listDecks(env, { user = null } = {}) {
  const decks = await env.DB.prepare(
    `SELECT fd.*, u.username as author,
       (SELECT COUNT(*) FROM flashcards WHERE deck_id = fd.id AND is_deleted = 0) as card_count
     FROM ${TABLE} fd
     LEFT JOIN users u ON fd.created_by = u.id
     WHERE fd.is_published = 1 OR fd.created_by = ?
     ORDER BY fd.created_at DESC`,
  )
    // -1 matches no row, so an anonymous caller sees published decks only.
    .bind(user?.id ?? -1)
    .all();
  return decks.results;
}

export async function getDeck(env, { deckId, user = null }) {
  const deck = await env.DB.prepare(
    `SELECT fd.*, u.username as author
     FROM ${TABLE} fd
     LEFT JOIN users u ON fd.created_by = u.id
     WHERE fd.id = ?`,
  )
    .bind(deckId)
    .first();
  if (!deck) throw notFound("Deck not found");

  // 404, not 403 — a draft should not even confirm it exists.
  if (!deck.is_published && !canSeeDraft(deck, user, env))
    throw notFound("Deck not found");

  const cards = await env.DB.prepare(
    "SELECT id, front, meaning, note FROM flashcards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at",
  )
    .bind(deckId)
    .all();

  const links = await env.DB.prepare(
    `SELECT cd.id, cd.title FROM deck_links dl
     JOIN challenge_decks cd ON dl.challenge_deck_id = cd.id
     WHERE dl.flashcard_deck_id = ?`,
  )
    .bind(deckId)
    .all();

  return {
    deck,
    cards: cards.results,
    linked_challenges: links.results,
  };
}

export async function createDeck(env, { user, title, category, description }) {
  if (!title || !category) throw badRequest("Title and category required");
  assertDeckFields({ title, description });

  const result = await env.DB.prepare(
    `INSERT INTO ${TABLE} (title, category, description, created_by) VALUES (?, ?, ?, ?)`,
  )
    .bind(title, category, description || null, user.id)
    .run();

  return { id: result.meta.last_row_id };
}

export async function updateDeck(
  env,
  { deckId, user, title, category, description },
) {
  await requireDeckOwner(env, KIND, deckId, user);
  assertDeckFields({ title, description });

  await env.DB.prepare(
    `UPDATE ${TABLE}
     SET title = COALESCE(?, title),
         category = COALESCE(?, category),
         description = COALESCE(?, description)
     WHERE id = ?`,
  )
    .bind(title || null, category || null, description || null, deckId)
    .run();

  return { ok: true };
}

export async function deleteDeck(env, { deckId, user }) {
  await requireDeckOwner(env, KIND, deckId, user);

  // Children first — D1 enforces foreign key constraints.
  await env.DB.prepare("DELETE FROM flashcards WHERE deck_id = ?")
    .bind(deckId)
    .run();
  await env.DB.prepare("DELETE FROM deck_links WHERE flashcard_deck_id = ?")
    .bind(deckId)
    .run();
  await env.DB.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(deckId).run();

  return { ok: true };
}

export async function addCard(env, { deckId, user, front, meaning, note }) {
  await requireDeckOwner(env, KIND, deckId, user);
  if (!front || !meaning) throw badRequest("Front and meaning required");

  const cardCount = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM flashcards WHERE deck_id = ? AND is_deleted = 0",
  )
    .bind(deckId)
    .first();
  const cardLimit = parseInt(env.MAX_CARDS_PER_DECK || "50", 10);
  if (cardCount.n >= cardLimit) {
    console.log(`[addFlashcard] deck ${deckId} at limit (${cardLimit})`);
    throw badRequest(`Deck has reached the ${cardLimit}-card limit`);
  }

  assertCardFields({ front, meaning, note });

  const result = await env.DB.prepare(
    "INSERT INTO flashcards (deck_id, front, meaning, note) VALUES (?, ?, ?, ?)",
  )
    .bind(deckId, front, meaning, note || null)
    .run();

  return { id: result.meta.last_row_id };
}

// Loads a card together with the owner of its deck, for authorization.
async function findCardWithOwner(env, cardId) {
  const card = await env.DB.prepare(
    `SELECT f.deck_id, fd.created_by FROM flashcards f
     JOIN ${TABLE} fd ON f.deck_id = fd.id WHERE f.id = ?`,
  )
    .bind(cardId)
    .first();
  if (!card) throw notFound("Card not found");
  return card;
}

async function requireCardOwner(env, cardId, user) {
  const card = await findCardWithOwner(env, cardId);
  if (card.created_by !== user.id && !isAdmin(user, env))
    throw forbidden("Not your deck");
  return card;
}

export async function updateCard(
  env,
  { cardId, user, front, meaning, note },
) {
  await requireCardOwner(env, cardId, user);
  assertCardFields({ front, meaning, note });

  await env.DB.prepare(
    "UPDATE flashcards SET front = COALESCE(?, front), meaning = COALESCE(?, meaning), note = ? WHERE id = ?",
  )
    .bind(
      front || null,
      meaning || null,
      note !== undefined ? note : null,
      cardId,
    )
    .run();

  return { ok: true };
}

export async function deleteCard(env, { cardId, user }) {
  await requireCardOwner(env, cardId, user);
  await env.DB.prepare("UPDATE flashcards SET is_deleted = 1 WHERE id = ?")
    .bind(cardId)
    .run();
  return { ok: true };
}

// Makes a draft deck visible to everyone.
//
// The challenge equivalent snapshots a version because leaderboard scores must
// stay pinned to the questions they were earned against. A flashcard deck has
// nothing to pin, so publishing is a flag and later edits go live immediately.
export async function publish(env, { deckId, user }) {
  await requireDeckOwner(env, KIND, deckId, user);

  const cards = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM flashcards WHERE deck_id = ? AND is_deleted = 0",
  )
    .bind(deckId)
    .first();

  if (cards.n < MIN_ITEMS_TO_PUBLISH)
    throw badRequest(`Need at least ${MIN_ITEMS_TO_PUBLISH} cards to publish`);

  await env.DB.prepare(`UPDATE ${TABLE} SET is_published = 1 WHERE id = ?`)
    .bind(deckId)
    .run();

  return { ok: true, is_published: 1, card_count: cards.n };
}
