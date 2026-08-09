// Challenge deck, question, and version operations.
//
// Every function takes (env, args) and returns plain data or throws an
// AppError. No Request, no Response, no CORS.

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
const KIND = DECK_KIND.CHALLENGE;
const TABLE = deckTable(KIND);

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 500;
const MAX_QUESTION = 500;
const MAX_CHOICE = 300;
const CHOICE_COUNT = 4;

function assertDeckFields({ title, description }) {
  if (title && title.length > MAX_TITLE)
    throw badRequest(`Title too long (max ${MAX_TITLE} chars)`);
  if (description && description.length > MAX_DESCRIPTION)
    throw badRequest(`Description too long (max ${MAX_DESCRIPTION} chars)`);
}

// A challenge deck is "published" once it has any version — that row is what
// makes it playable and scoreable. Same visibility rule as flashcard decks:
// drafts belong to their owner only, admins included. See flashcards.listDecks.
export async function listDecks(env, { user = null } = {}) {
  const decks = await env.DB.prepare(
    `SELECT cd.*, u.username as author,
       (SELECT MAX(version) FROM challenge_versions WHERE deck_id = cd.id) as current_version,
       (SELECT card_count FROM challenge_versions WHERE deck_id = cd.id ORDER BY version DESC LIMIT 1) as card_count
     FROM ${TABLE} cd
     LEFT JOIN users u ON cd.created_by = u.id
     WHERE EXISTS (SELECT 1 FROM challenge_versions WHERE deck_id = cd.id)
        OR cd.created_by = ?
     ORDER BY cd.created_at DESC`,
  )
    .bind(user?.id ?? -1)
    .all();
  return decks.results;
}

export async function getDeck(env, { deckId, user = null }) {
  const deck = await env.DB.prepare(
    `SELECT cd.*, u.username as author
     FROM ${TABLE} cd
     LEFT JOIN users u ON cd.created_by = u.id
     WHERE cd.id = ?`,
  )
    .bind(deckId)
    .first();
  if (!deck) throw notFound("Deck not found");

  const version = await env.DB.prepare(
    "SELECT * FROM challenge_versions WHERE deck_id = ? ORDER BY version DESC LIMIT 1",
  )
    .bind(deckId)
    .first();

  // A deck with no version is a draft. Same rule as flashcards: 404 for
  // everyone but its owner, so the list filter cannot be sidestepped by id.
  if (!version && !canSeeDraft(deck, user, env))
    throw notFound("Deck not found");

  // `cards` is the snapshot published in the latest version, so an in-progress
  // edit never changes what players are currently scored against.
  let cards = [];
  if (version) {
    let cardIds;
    try {
      cardIds = JSON.parse(version.card_ids);
      if (!Array.isArray(cardIds)) cardIds = [];
    } catch {
      cardIds = [];
    }
    if (cardIds.length > 0) {
      const placeholders = cardIds.map(() => "?").join(",");
      cards = (
        await env.DB.prepare(
          `SELECT id, question, choices, answer FROM challenge_cards WHERE id IN (${placeholders})`,
        )
          .bind(...cardIds)
          .all()
      ).results;
    }
  }

  const allCards = await env.DB.prepare(
    "SELECT id, question, choices, answer FROM challenge_cards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at",
  )
    .bind(deckId)
    .all();

  const links = await env.DB.prepare(
    `SELECT fd.id, fd.title FROM deck_links dl
     JOIN flashcard_decks fd ON dl.flashcard_deck_id = fd.id
     WHERE dl.challenge_deck_id = ?`,
  )
    .bind(deckId)
    .all();

  return {
    deck,
    version,
    cards,
    all_cards: allCards.results,
    linked_flashcard_decks: links.results,
  };
}

export async function createDeck(
  env,
  { user, title, category, description, article, linked_flashcard_deck_id },
) {
  if (!title || !category) throw badRequest("Title and category required");
  assertDeckFields({ title, description });

  const result = await env.DB.prepare(
    `INSERT INTO ${TABLE} (title, category, description, article, created_by) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(title, category, description || null, article || null, user.id)
    .run();

  const challengeId = result.meta.last_row_id;

  if (linked_flashcard_deck_id) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO deck_links (flashcard_deck_id, challenge_deck_id, created_by) VALUES (?, ?, ?)",
    )
      .bind(linked_flashcard_deck_id, challengeId, user.id)
      .run();
  }

  return { id: challengeId };
}

export async function updateDeck(env, args) {
  const { deckId, user, title, category, description, article } = args;
  await requireDeckOwner(env, KIND, deckId, user);
  assertDeckFields({ title, description });

  await env.DB.prepare(
    `UPDATE ${TABLE}
     SET title       = COALESCE(?, title),
         category    = COALESCE(?, category),
         description = COALESCE(?, description),
         article     = ?
     WHERE id = ?`,
  )
    .bind(
      title || null,
      category || null,
      description || null,
      article || null,
      deckId,
    )
    .run();

  // Only touch the deck link when the caller explicitly includes the field.
  // Omitting it (e.g. an article-only update from the AI confirm flow) leaves
  // the existing link alone rather than silently wiping it.
  if ("linked_flashcard_deck_id" in args) {
    const { linked_flashcard_deck_id } = args;
    await env.DB.prepare("DELETE FROM deck_links WHERE challenge_deck_id = ?")
      .bind(deckId)
      .run();
    if (linked_flashcard_deck_id) {
      await env.DB.prepare(
        "INSERT INTO deck_links (challenge_deck_id, flashcard_deck_id) VALUES (?, ?)",
      )
        .bind(deckId, linked_flashcard_deck_id)
        .run();
    }
  }

  return { ok: true };
}

export async function deleteDeck(env, { deckId, user }) {
  await requireDeckOwner(env, KIND, deckId, user);

  // Scores reference challenge_versions and the schema has no ON DELETE
  // CASCADE, so unwind the graph from the leaves inward.
  await env.DB.prepare(
    "DELETE FROM scores WHERE challenge_version_id IN (SELECT id FROM challenge_versions WHERE deck_id = ?)",
  )
    .bind(deckId)
    .run();
  await env.DB.prepare("DELETE FROM challenge_versions WHERE deck_id = ?")
    .bind(deckId)
    .run();
  await env.DB.prepare("DELETE FROM challenge_cards WHERE deck_id = ?")
    .bind(deckId)
    .run();
  await env.DB.prepare("DELETE FROM deck_links WHERE challenge_deck_id = ?")
    .bind(deckId)
    .run();
  await env.DB.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(deckId).run();

  return { ok: true };
}

export async function addCard(
  env,
  { deckId, user, question, choices, answer },
) {
  await requireDeckOwner(env, KIND, deckId, user);

  if (!question || !choices || answer === undefined)
    throw badRequest("Question, choices, and answer required");
  if (!Array.isArray(choices) || choices.length !== CHOICE_COUNT)
    throw badRequest(`Exactly ${CHOICE_COUNT} choices required`);
  if (answer < 0 || answer > CHOICE_COUNT - 1)
    throw badRequest(`Answer must be 0-${CHOICE_COUNT - 1}`);

  const cardCount = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM challenge_cards WHERE deck_id = ? AND is_deleted = 0",
  )
    .bind(deckId)
    .first();
  const questionLimit = parseInt(env.MAX_QUESTIONS_PER_DECK || "50", 10);
  if (cardCount.n >= questionLimit) {
    console.log(`[addChallengeCard] deck ${deckId} at limit (${questionLimit})`);
    throw badRequest(`Deck has reached the ${questionLimit}-question limit`);
  }

  if (question.length > MAX_QUESTION)
    throw badRequest(`Question too long (max ${MAX_QUESTION} chars)`);
  if (choices.some((c) => c.length > MAX_CHOICE))
    throw badRequest(`Choice too long (max ${MAX_CHOICE} chars each)`);

  const result = await env.DB.prepare(
    "INSERT INTO challenge_cards (deck_id, question, choices, answer) VALUES (?, ?, ?, ?)",
  )
    .bind(deckId, question, JSON.stringify(choices), answer)
    .run();

  return { id: result.meta.last_row_id };
}

async function requireCardOwner(env, cardId, user) {
  const card = await env.DB.prepare(
    `SELECT c.deck_id, cd.created_by FROM challenge_cards c
     JOIN ${TABLE} cd ON c.deck_id = cd.id WHERE c.id = ?`,
  )
    .bind(cardId)
    .first();
  if (!card) throw notFound("Card not found");
  if (card.created_by !== user.id && !isAdmin(user, env))
    throw forbidden("Not your deck");
  return card;
}

export async function updateCard(
  env,
  { cardId, user, question, choices, answer },
) {
  await requireCardOwner(env, cardId, user);

  if (choices && (!Array.isArray(choices) || choices.length !== CHOICE_COUNT))
    throw badRequest(`Exactly ${CHOICE_COUNT} choices required`);
  if (
    answer !== undefined &&
    (typeof answer !== "number" || answer < 0 || answer > CHOICE_COUNT - 1)
  )
    throw badRequest(`Answer must be 0-${CHOICE_COUNT - 1}`);
  if (question && question.length > MAX_QUESTION)
    throw badRequest(`Question too long (max ${MAX_QUESTION} chars)`);
  if (choices && choices.some((c) => c.length > MAX_CHOICE))
    throw badRequest(`Choice too long (max ${MAX_CHOICE} chars each)`);

  await env.DB.prepare(
    "UPDATE challenge_cards SET question = COALESCE(?, question), choices = COALESCE(?, choices), answer = COALESCE(?, answer) WHERE id = ?",
  )
    .bind(
      question || null,
      choices ? JSON.stringify(choices) : null,
      answer !== undefined ? answer : null,
      cardId,
    )
    .run();

  return { ok: true };
}

export async function deleteCard(env, { cardId, user }) {
  await requireCardOwner(env, cardId, user);
  await env.DB.prepare("UPDATE challenge_cards SET is_deleted = 1 WHERE id = ?")
    .bind(cardId)
    .run();
  return { ok: true };
}

export async function publish(env, { deckId, user }) {
  await requireDeckOwner(env, KIND, deckId, user);

  const cards = await env.DB.prepare(
    "SELECT id FROM challenge_cards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at",
  )
    .bind(deckId)
    .all();

  if (cards.results.length < MIN_ITEMS_TO_PUBLISH)
    throw badRequest(`Need at least ${MIN_ITEMS_TO_PUBLISH} cards to publish`);

  const cardIds = cards.results.map((c) => c.id);

  // The version number is computed inside the INSERT so two concurrent
  // publishes cannot both read the same MAX(version).
  const result = await env.DB.prepare(
    `INSERT INTO challenge_versions (deck_id, version, card_ids, card_count)
     VALUES (?, (SELECT COALESCE(MAX(version), 0) + 1 FROM challenge_versions WHERE deck_id = ?), ?, ?)`,
  )
    .bind(deckId, deckId, JSON.stringify(cardIds), cardIds.length)
    .run();

  const newVersion = await env.DB.prepare(
    "SELECT version FROM challenge_versions WHERE rowid = ?",
  )
    .bind(result.meta.last_row_id)
    .first();

  return { version: newVersion.version, card_count: cardIds.length };
}
