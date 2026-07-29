import { json } from "../respond.js";
import { readBody } from "../body.js";
import { requireUser } from "../session.js";
import * as deckLinks from "../../services/deckLinks.js";

export async function create(request, env) {
  const user = await requireUser(request, env);
  const result = await deckLinks.createLink(
    env,
    await readBody(request, { user }),
  );
  return json(result, 201, request);
}

export async function list(request, env) {
  const params = new URL(request.url).searchParams;
  const links = await deckLinks.listLinks(env, {
    flashcardDeckId: params.get("flashcard_deck_id"),
    challengeDeckId: params.get("challenge_deck_id"),
  });
  return json({ links }, 200, request);
}

export async function remove(request, env, { linkId }) {
  const user = await requireUser(request, env);
  return json(await deckLinks.deleteLink(env, { linkId, user }), 200, request);
}
