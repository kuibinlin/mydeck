import { env, SELF } from "cloudflare:test";

export const BASE = "http://localhost:8787";
export const ADMIN_EMAIL = "kuibin.dev@gmail.com"; // matches ADMIN_EMAILS in wrangler.toml

// Insert a user directly and return the full row.
export async function createUser({
  email = "user@example.com",
  username = "user",
  githubId = null,
} = {}) {
  await env.DB.prepare(
    "INSERT INTO users (email, username, github_id) VALUES (?, ?, ?)",
  )
    .bind(email, username, githubId)
    .run();
  return await env.DB.prepare(
    "SELECT id, email, username FROM users WHERE email = ?",
  )
    .bind(email)
    .first();
}

// Write a session straight into KV — same shape the worker stores on verify.
export async function createSession(user) {
  const token = `test-session-${user.id}-${user.username}`;
  await env.SESSIONS.put(
    token,
    JSON.stringify({ id: user.id, email: user.email, username: user.username }),
  );
  return token;
}

// Create a user and an active session in one step.
export async function createUserWithSession(opts = {}) {
  const user = await createUser(opts);
  const token = await createSession(user);
  return { user, token };
}

// Perform a request against the worker. Pass `token` to authenticate.
export function request(path, { method = "GET", body, token, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Cookie"] = `session=${token}`;
  if (origin) headers["Origin"] = origin;
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
}

// request() + parsed JSON body, for the common assert-on-both case.
export async function requestJson(path, opts) {
  const res = await request(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { res, data, status: res.status };
}

// --- Fixture builders -------------------------------------------------------

export async function createFlashcardDeck(token, overrides = {}) {
  const { data } = await requestJson("/api/flashcard-decks", {
    method: "POST",
    token,
    body: { title: "Deck", category: "Language", ...overrides },
  });
  return data.id;
}

export async function createChallengeDeck(token, overrides = {}) {
  const { data } = await requestJson("/api/challenge-decks", {
    method: "POST",
    token,
    body: { title: "Quiz", category: "Language", ...overrides },
  });
  return data.id;
}

// Add `count` cards to a flashcard deck and publish it, so it is visible to
// users other than its owner.
export async function publishFlashcardDeck(token, deckId, count = 3) {
  for (let i = 1; i <= count; i++) {
    await requestJson(`/api/flashcard-decks/${deckId}/cards`, {
      method: "POST",
      token,
      body: { front: `front ${i}`, meaning: `meaning ${i}` },
    });
  }
  const { data } = await requestJson(
    `/api/flashcard-decks/${deckId}/publish`,
    { method: "POST", token },
  );
  return data;
}

export function sampleQuestion(n = 1) {
  return {
    question: `Question ${n}?`,
    choices: [`A${n}`, `B${n}`, `C${n}`, `D${n}`],
    answer: n % 4,
  };
}

// Add `count` questions to a challenge deck and publish it.
export async function publishChallenge(token, deckId, count = 3) {
  for (let i = 1; i <= count; i++) {
    await requestJson(`/api/challenge-decks/${deckId}/cards`, {
      method: "POST",
      token,
      body: sampleQuestion(i),
    });
  }
  const { data } = await requestJson(
    `/api/challenge-decks/${deckId}/publish`,
    { method: "POST", token },
  );
  const version = await env.DB.prepare(
    "SELECT id, version, card_count FROM challenge_versions WHERE deck_id = ? ORDER BY version DESC LIMIT 1",
  )
    .bind(deckId)
    .first();
  return { ...data, versionId: version.id, cardCount: version.card_count };
}
