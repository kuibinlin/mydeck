import { json } from "../respond.js";
import { readBody } from "../body.js";
import { getUser, requireUser } from "../session.js";
import * as flashcards from "../../services/flashcards.js";

// getUser, not requireUser: the list stays readable without a session, it just
// contains no drafts. Passing the viewer is what surfaces their own drafts.
export async function listDecks(request, env) {
  const user = await getUser(request, env);
  return json({ decks: await flashcards.listDecks(env, { user }) }, 200, request);
}

export async function createDeck(request, env) {
  const user = await requireUser(request, env);
  const { id } = await flashcards.createDeck(
    env,
    await readBody(request, { user }),
  );
  return json({ ok: true, id }, 201, request);
}

export async function getDeck(request, env, { deckId }) {
  const user = await getUser(request, env);
  return json(await flashcards.getDeck(env, { deckId, user }), 200, request);
}

export async function updateDeck(request, env, { deckId }) {
  const user = await requireUser(request, env);
  const result = await flashcards.updateDeck(
    env,
    await readBody(request, { deckId, user }),
  );
  return json(result, 200, request);
}

export async function deleteDeck(request, env, { deckId }) {
  const user = await requireUser(request, env);
  return json(await flashcards.deleteDeck(env, { deckId, user }), 200, request);
}

export async function addCard(request, env, { deckId }) {
  const user = await requireUser(request, env);
  const { id } = await flashcards.addCard(
    env,
    await readBody(request, { deckId, user }),
  );
  return json({ ok: true, id }, 201, request);
}

export async function updateCard(request, env, { cardId }) {
  const user = await requireUser(request, env);
  const result = await flashcards.updateCard(
    env,
    await readBody(request, { cardId, user }),
  );
  return json(result, 200, request);
}

export async function deleteCard(request, env, { cardId }) {
  const user = await requireUser(request, env);
  return json(await flashcards.deleteCard(env, { cardId, user }), 200, request);
}

export async function publish(request, env, { deckId }) {
  const user = await requireUser(request, env);
  const result = await flashcards.publish(env, { deckId, user });
  return json(result, 200, request);
}
