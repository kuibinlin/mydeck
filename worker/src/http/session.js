// Session cookie handling.
//
// The session token never reaches JavaScript on the frontend: it lives in an
// HttpOnly cookie and is exchanged for a user object in KV on each request.

import { unauthorized } from "../services/errors.js";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// SameSite=Lax is safe because the frontend (linsnotes.com / mydeck.linsnotes.com)
// and API (mydeckapi.linsnotes.com) share the same eTLD+1 (linsnotes.com) — same-site.
// This fixes iOS Safari ITP, which blocked SameSite=None cookies from cross-site
// workers.dev domains.
//
// Call with null to clear the cookie (Max-Age=0).
export function sessionCookie(token) {
  if (!token) {
    return "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
  }
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ONE_YEAR_SECONDS}`;
}

export function getTokenFromCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

// Returns the stored user object, or null when there is no valid session.
export async function getUser(request, env) {
  const token = getTokenFromCookie(request);
  if (!token) return null;
  return await env.SESSIONS.get(token, "json");
}

export async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) throw unauthorized();
  return user;
}
