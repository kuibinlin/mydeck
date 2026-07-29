// Links between flashcard decks and challenge decks.

import { badRequest } from "./errors.js";
import { isAdmin } from "./access.js";

export async function createLink(
  env,
  { user, flashcard_deck_id, challenge_deck_id },
) {
  if (!flashcard_deck_id || !challenge_deck_id)
    throw badRequest("Both deck IDs required");

  await env.DB.prepare(
    "INSERT OR IGNORE INTO deck_links (flashcard_deck_id, challenge_deck_id, created_by) VALUES (?, ?, ?)",
  )
    .bind(flashcard_deck_id, challenge_deck_id, user.id)
    .run();

  return { ok: true };
}

export async function listLinks(env, { flashcardDeckId, challengeDeckId }) {
  if (flashcardDeckId) {
    const links = await env.DB.prepare(
      `SELECT dl.id, cd.id as challenge_deck_id, cd.title
       FROM deck_links dl JOIN challenge_decks cd ON dl.challenge_deck_id = cd.id
       WHERE dl.flashcard_deck_id = ?`,
    )
      .bind(flashcardDeckId)
      .all();
    return links.results;
  }

  if (challengeDeckId) {
    const links = await env.DB.prepare(
      `SELECT dl.id, fd.id as flashcard_deck_id, fd.title
       FROM deck_links dl JOIN flashcard_decks fd ON dl.flashcard_deck_id = fd.id
       WHERE dl.challenge_deck_id = ?`,
    )
      .bind(challengeDeckId)
      .all();
    return links.results;
  }

  throw badRequest("Provide flashcard_deck_id or challenge_deck_id");
}

export async function deleteLink(env, { linkId, user }) {
  const query = isAdmin(user, env)
    ? env.DB.prepare("DELETE FROM deck_links WHERE id = ?").bind(linkId)
    : env.DB.prepare(
        "DELETE FROM deck_links WHERE id = ? AND created_by = ?",
      ).bind(linkId, user.id);
  await query.run();
  return { ok: true };
}
