// Login, session issuing, and account creation.
//
// Sessions are opaque random tokens stored in KV, not JWTs — revoking one is a
// KV delete, and nothing about the user is readable from the token itself.

import { AppError, badRequest, notFound, unauthorized } from "./errors.js";
import { sendLoginEmail } from "../integrations/resend.js";
import * as github from "../integrations/github.js";

const EMAIL_RE = /.+@.+\..+/;
const MAGIC_TTL_SECONDS = 900; // 15 minutes
const SESSION_TTL_SECONDS = 2592000; // 30 days
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes
const HANDOFF_TTL_SECONDS = 120; // 2 minutes

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const findByEmail = (env, email) =>
  env.DB.prepare("SELECT id, username FROM users WHERE email = ?")
    .bind(email)
    .first();

export async function createSession(env, user) {
  const token = generateToken();
  await env.SESSIONS.put(
    token,
    JSON.stringify({
      id: user.id,
      email: user.email,
      username: user.username,
    }),
    { expirationTtl: SESSION_TTL_SECONDS },
  );
  return token;
}

export async function destroySession(env, token) {
  if (token) await env.SESSIONS.delete(token);
  return { ok: true };
}

// Step one of the magic-link flow. Returns { needsUsername } when the email is
// new and the caller has not chosen a username yet.
export async function startEmailLogin(env, { email, username, frontendBase }) {
  if (!email) throw badRequest("Email is required");
  if (!EMAIL_RE.test(email)) throw badRequest("Invalid email address");

  const existingUser = await findByEmail(env, email);

  if (!existingUser && !username) {
    return { needsUsername: true, message: "Welcome! Please pick a username." };
  }

  if (!existingUser && username) {
    const taken = await env.DB.prepare(
      "SELECT id FROM users WHERE username = ?",
    )
      .bind(username)
      .first();
    if (taken) throw new AppError(409, "Username already taken");

    await env.DB.prepare("INSERT INTO users (email, username) VALUES (?, ?)")
      .bind(email, username)
      .run();
  }

  const user = existingUser || (await findByEmail(env, email));
  const token = generateToken();

  await env.SESSIONS.put(
    `magic:${token}`,
    JSON.stringify({ email, username: user.username }),
    { expirationTtl: MAGIC_TTL_SECONDS },
  );

  await sendLoginEmail(env, {
    to: email,
    displayName: user.username,
    loginUrl: `${frontendBase.replace(/\/$/, "")}/login#verify=${token}`,
  });

  return { ok: true, message: "Check your email for the login link" };
}

// Step two: exchange a one-time magic token for a session.
// Also used by the GitHub flow, which mints a handoff code in the same space.
export async function verifyMagicToken(env, { token }) {
  if (!token) throw badRequest("Token required");

  const data = await env.SESSIONS.get(`magic:${token}`, "json");
  if (!data) throw unauthorized("Invalid or expired token");

  await env.SESSIONS.delete(`magic:${token}`); // one-time use

  const user = await env.DB.prepare(
    "SELECT id, email, username FROM users WHERE email = ?",
  )
    .bind(data.email)
    .first();
  if (!user) throw notFound("User not found");

  return { user, sessionToken: await createSession(env, user) };
}

export async function createOAuthState(env) {
  const state = generateToken();
  await env.SESSIONS.put(`oauth_state:${state}`, "1", {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
  return state;
}

export function githubAuthorizeUrl(env, { redirectUri, state }) {
  return github.authorizeUrl({
    clientId: env.GITHUB_CLIENT_ID,
    redirectUri,
    state,
  });
}

// Completes the GitHub flow and returns a short-lived handoff code.
//
// The session is NOT created here. Cookies set during a cross-origin redirect
// are dropped by Safari ITP on iOS, so the frontend exchanges this code through
// /auth/verify instead — a direct fetch, where the Set-Cookie sticks.
export async function completeGitHubLogin(env, { code, state }) {
  if (!code || !state) throw unauthorized("auth_failed");

  const stateKey = `oauth_state:${state}`;
  const validState = await env.SESSIONS.get(stateKey);
  if (!validState) throw unauthorized("auth_failed");
  await env.SESSIONS.delete(stateKey);

  const accessToken = await github.exchangeCode(env, { code });
  if (!accessToken) throw unauthorized("auth_failed");

  const ghUser = await github.fetchUser(accessToken);
  const email = ghUser.email || (await github.fetchPrimaryEmail(accessToken));

  const githubId = String(ghUser.id);
  const username = ghUser.login;

  let user = await env.DB.prepare(
    "SELECT id, username FROM users WHERE github_id = ?",
  )
    .bind(githubId)
    .first();

  if (!user) {
    // Someone may already hold this username via email signup.
    let finalUsername = username;
    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE username = ?",
    )
      .bind(username)
      .first();
    if (existing) finalUsername = `${username}_${githubId.slice(-4)}`;

    await env.DB.prepare(
      "INSERT INTO users (email, username, github_id, github_username) VALUES (?, ?, ?, ?)",
    )
      .bind(email, finalUsername, githubId, username)
      .run();

    user = await env.DB.prepare(
      "SELECT id, username FROM users WHERE github_id = ?",
    )
      .bind(githubId)
      .first();
  }

  const handoffCode = generateToken();
  await env.SESSIONS.put(`magic:${handoffCode}`, JSON.stringify({ email }), {
    expirationTtl: HANDOFF_TTL_SECONDS,
  });

  return { handoffCode };
}
