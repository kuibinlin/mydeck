// Request body parsing.
//
// Every write route builds its service arguments from two sources: the JSON
// body (untrusted, from the client) and server-derived values (the
// authenticated user, path params). Those must never be merged in the other
// order.
//
//   { user, ...body }   ← body wins. A request carrying {"user":{"id":7}}
//                         replaces the authenticated user. Privilege
//                         escalation, not a style nit.
//   { ...body, user }   ← trusted wins. Correct.
//
// Doing the merge here rather than in each handler means the order is decided
// once, in a place with a comment explaining it, instead of thirteen times in
// a place where it looks like formatting.

import { badRequest } from "../services/errors.js";

export async function readBody(request, trusted = {}) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }

  // A non-object body would spread nonsense into the arguments — {..."ab"}
  // yields {0:"a",1:"b"} — so reject it rather than pass it on.
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }

  return { ...body, ...trusted };
}
