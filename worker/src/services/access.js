// Authorization rules shared across services.
//
// These operate on a plain `user` object ({ id, email, username }) rather than
// a Request, so agent tools enforce the same rules as HTTP routes.

import { forbidden, notFound } from "./errors.js";

// Ownable deck kinds, mapped to their table.
//
// SQLite cannot parameterise an identifier, so a table-generic ownership check
// has to interpolate the table name into the SQL. Callers therefore name a
// KIND, never a table, and this map is what guarantees the interpolated value
// is one of exactly two compile-time constants — no matter what a caller, or a
// future agent tool acting on model output, passes in.
//
// A Map rather than an object literal on purpose: `{}["constructor"]` resolves
// through the prototype chain to a truthy value, so an object-literal
// allowlist would happily "resolve" keys like "toString" or "constructor" and
// interpolate a function into the query. `Map.get` has no prototype chain.
const DECK_TABLES = new Map([
  ["flashcard", "flashcard_decks"],
  ["challenge", "challenge_decks"],
]);

export const DECK_KIND = {
  FLASHCARD: "flashcard",
  CHALLENGE: "challenge",
};

// Resolves a kind to its table, so a service queries the same table whose
// ownership it just checked rather than keeping a second copy of the name.
//
// Throws a plain Error (no `status`): an unknown kind is a bug in our code,
// not bad input from a client, and should surface as a logged 500 rather than
// masquerade as a 4xx.
export function deckTable(kind) {
  const table = DECK_TABLES.get(kind);
  if (!table) throw new Error(`Unknown deck kind: ${JSON.stringify(kind)}`);
  return table;
}

// Admins are configured by email in wrangler.toml (ADMIN_EMAILS, comma
// separated) rather than by a database column — no migration, no admin UI,
// and no way to change it except by deploying.
export function isAdmin(user, env) {
  if (!env.ADMIN_EMAILS) return false;
  return env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim())
    .includes(user.email);
}

// Whether `user` may see a deck that has not been published yet.
//
// Drafts are filtered out of the deck lists, but a list filter alone would be a
// half-measure: anyone who guessed an id could still read the deck. Both list
// and read consult this, so "only you can see this deck" is literally true.
//
// Admins pass. They are excluded from draft *listings* — a relevance decision,
// so their list is not flooded — but they keep full access to any deck by id.
export function canSeeDraft(deck, user, env) {
  if (!user) return false;
  return deck.created_by === user.id || isAdmin(user, env);
}

// Verifies the user owns the given deck, or is an admin.
// Throws 404 when the deck does not exist, 403 when it belongs to someone else.
//
// Existence is checked before the admin bypass so that a missing deck is a 404
// for everyone. Returning early for admins made writes to a nonexistent deck
// silently succeed with 200 (or fail as an opaque 500 on insert).
export async function requireDeckOwner(env, kind, deckId, user) {
  const table = deckTable(kind);

  const deck = await env.DB.prepare(
    `SELECT created_by FROM ${table} WHERE id = ?`,
  )
    .bind(deckId)
    .first();

  if (!deck) throw notFound("Deck not found");
  if (isAdmin(user, env)) return;
  if (deck.created_by !== user.id) throw forbidden("Not your deck");
}
