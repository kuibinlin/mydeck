// === LinNotes API Worker ===

import {
  validateFlashcards,
  validateChallengeCards,
  shuffleChoices,
  checkRateLimit,
  logUsage,
  callAI,
} from "./ai.js";

// ← UPDATE THESE to your frontend domains before deploying 
const PROD_ORIGINS = [
  "https://linsnotes.com",
  "https://mydeck.linsnotes.com",
];

// === CORS ===
// Access-Control-Allow-Credentials is required for cross-origin cookie-based auth.
// The origin must be explicit (not '*') when credentials are included.
// localhost origins are only allowed when running via wrangler dev (worker URL is localhost).
function corsHeaders(request) {
  const workerHost = new URL(request.url).hostname;
  const isDev = workerHost === "localhost" || workerHost === "127.0.0.1";
  const allowedOrigins = isDev
    ? [...PROD_ORIGINS, "http://localhost:5173", "http://127.0.0.1:5173"]
    : PROD_ORIGINS;
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
  // Only reflect allowed origins — unknown origins get no ACAO header,
  // which causes browsers to block the cross-origin request.
  if (allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Pass a cookie string as the 4th argument to set a Set-Cookie header on the response.
function json(data, status = 200, request = null, cookie = null) {
  const headers = {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    ...(request ? corsHeaders(request) : {}),
  };
  if (cookie !== null) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(data), { status, headers });
}

// === Auth Helpers ===
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// === Cookie Helpers ===
// SameSite=Lax is safe because the frontend (linsnotes.com / mydeck.linsnotes.com)
// and API (mydeckapi.linsnotes.com) share the same eTLD+1 (linsnotes.com) — same-site.
// This fixes iOS Safari ITP which blocked SameSite=None cookies from cross-site workers.dev domains.
//
// To clear the cookie, call sessionCookie(null) — sets Max-Age=0.
function sessionCookie(token) {
  const ONE_YEAR = 60 * 60 * 24 * 365;
  if (!token) {
    return "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
  }
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ONE_YEAR}`;
}

// Extracts the session token from the Cookie request header.
function getTokenFromCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

// Looks up the session token in KV and returns the stored user object, or null.
async function getUser(request, env) {
  const token = getTokenFromCookie(request);
  if (!token) return null;
  return await env.SESSIONS.get(token, "json");
}

async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) throw { status: 401, message: "Not authenticated" };
  return user;
}

// Returns true if the user's email is in the ADMIN_EMAILS secret (comma-separated).
// Admins can edit and delete any deck regardless of who created it.
function isAdmin(user, env) {
  if (!env.ADMIN_EMAILS) return false;
  return env.ADMIN_EMAILS.split(",").map((e) => e.trim()).includes(user.email);
}

// Verifies the logged-in user owns the given deck, or is an admin.
// Throws 404/403 on failure.
async function requireDeckOwner(env, table, deckId, user) {
  if (isAdmin(user, env)) return;
  const deck = await env.DB.prepare(
    `SELECT created_by FROM ${table} WHERE id = ?`,
  )
    .bind(deckId)
    .first();
  if (!deck) throw { status: 404, message: "Deck not found" };
  if (deck.created_by !== user.id) throw { status: 403, message: "Not your deck" };
}

// === Auth Routes ===
async function handleLogin(request, env) {
  const { email, username, redirectBase } = await request.json();
  if (!email) {
    return json({ error: "Email is required" }, 400, request);
  }
  if (!/.+@.+\..+/.test(email)) {
    return json({ error: "Invalid email address" }, 400, request);
  }

  // Check if user exists
  const existingUser = await env.DB.prepare(
    "SELECT id, username FROM users WHERE email = ?",
  )
    .bind(email)
    .first();

  if (!existingUser && !username) {
    // New user, need username
    return json(
      { needsUsername: true, message: "Welcome! Please pick a username." },
      200,
      request,
    );
  }

  if (!existingUser && username) {
    // Check if username is taken
    const taken = await env.DB.prepare(
      "SELECT id FROM users WHERE username = ?",
    )
      .bind(username)
      .first();
    if (taken) {
      return json({ error: "Username already taken" }, 409, request);
    }
    // Create new user
    await env.DB.prepare("INSERT INTO users (email, username) VALUES (?, ?)")
      .bind(email, username)
      .run();
  }

  const user =
    existingUser ||
    (await env.DB.prepare("SELECT id, username FROM users WHERE email = ?")
      .bind(email)
      .first());
  const displayName = user.username;

  // Generate magic link token
  const token = generateToken();
  await env.SESSIONS.put(
    `magic:${token}`,
    JSON.stringify({ email, username: displayName }),
    {
      expirationTtl: 900, // 15 minutes
    },
  );

  const frontendBase =
    redirectBase && PROD_ORIGINS.includes(redirectBase)
      ? redirectBase + "/"
      : env.FRONTEND_URL;

  // Send email via Resend
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: email,
      subject: "Your Linsnotes login link",
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px;">
          <h2>Hi ${escapeHtml(displayName)}!</h2>
          <p>Click the button below to log in:</p>
          <a href="${frontendBase.replace(/\/$/, "")}/login#verify=${token}"
             style="display:inline-block;padding:12px 24px;background:#0071e3;color:#fff;
                    text-decoration:none;border-radius:8px;font-weight:600;">
            Log in to MyDeck
          </a>
          <p style="color:#888;font-size:13px;margin-top:20px;">
            This link expires in 15 minutes. If you didn't request this, ignore this email.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    return json({ error: "Failed to send email" }, 500, request);
  }

  return json(
    { ok: true, message: "Check your email for the login link" },
    200,
    request,
  );
}

async function handleVerify(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "Token required" }, 400, request);

  const data = await env.SESSIONS.get(`magic:${token}`, "json");
  if (!data) return json({ error: "Invalid or expired token" }, 401, request);

  // Delete the magic token (one-time use)
  await env.SESSIONS.delete(`magic:${token}`);

  // Get user from DB
  const user = await env.DB.prepare(
    "SELECT id, email, username FROM users WHERE email = ?",
  )
    .bind(data.email)
    .first();
  if (!user) return json({ error: "User not found" }, 404, request);

  // Create session
  const sessionToken = generateToken();
  await env.SESSIONS.put(
    sessionToken,
    JSON.stringify({
      id: user.id,
      email: user.email,
      username: user.username,
    }),
    {
      expirationTtl: 2592000, // 30 days
    },
  );

  // Cookie carries the session — token is never sent to the frontend.
  return json(
    { ok: true, user: { id: user.id, username: user.username, isAdmin: isAdmin(user, env) } },
    200,
    request,
    sessionCookie(sessionToken),
  );
}

async function handleGitHubAuth(request, env) {
  const state = generateToken();
  await env.SESSIONS.put(`oauth_state:${state}`, "1", { expirationTtl: 600 }); // 10 min
  const redirectUri = `${new URL(request.url).origin}/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user user:email&state=${state}`;
  return Response.redirect(url, 302);
}

async function handleGitHubCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) return Response.redirect(`${env.FRONTEND_URL}#error=auth_failed`, 302);

  const stateKey = `oauth_state:${state}`;
  const validState = await env.SESSIONS.get(stateKey);
  if (!validState) return Response.redirect(`${env.FRONTEND_URL}#error=auth_failed`, 302);
  await env.SESSIONS.delete(stateKey);

  // Exchange code for token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return Response.redirect(`${env.FRONTEND_URL}#error=auth_failed`, 302);
  }

  // Get GitHub user info
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "LinNotes",
    },
  });
  const ghUser = await userRes.json();

  // Get email if not public
  let email = ghUser.email;
  if (!email) {
    const emailRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "LinNotes",
      },
    });
    const emails = await emailRes.json();
    const primary = emails.find((e) => e.primary) || emails[0];
    email = primary?.email;
  }

  // Create or find user
  const githubId = String(ghUser.id);
  const username = ghUser.login;

  let user = await env.DB.prepare(
    "SELECT id, username FROM users WHERE github_id = ?",
  )
    .bind(githubId)
    .first();

  if (!user) {
    // Check if username exists, append suffix if needed
    let finalUsername = username;
    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE username = ?",
    )
      .bind(username)
      .first();
    if (existing) {
      finalUsername = `${username}_${githubId.slice(-4)}`;
    }

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

  // Create a short-lived handoff code for the frontend to exchange via /auth/verify.
  // Avoids relying on cookies set during cross-origin redirects, which are blocked
  // by Safari ITP on iOS (all iOS browsers use WebKit and share this restriction).
  // The frontend's existing #verify= handler calls /auth/verify, which creates the
  // session and sets the cookie in a direct fetch response — the correct context.
  const handoffCode = generateToken();
  await env.SESSIONS.put(
    `magic:${handoffCode}`,
    JSON.stringify({ email }),
    { expirationTtl: 120 }, // 2 min, one-time use
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${env.FRONTEND_URL.replace(/\/$/, "")}/login#verify=${handoffCode}`,
    },
  });
}

async function handleMe(request, env) {
  const user = await requireUser(request, env);
  return json({ user: { ...user, isAdmin: isAdmin(user, env) } }, 200, request);
}

async function handleLogout(request, env) {
  const token = getTokenFromCookie(request);
  if (token) await env.SESSIONS.delete(token);
  // Clear the cookie regardless of whether the token existed.
  return json({ ok: true }, 200, request, sessionCookie(null));
}

// === Flashcard Routes ===
async function handleFlashcardDecks(request, env) {
  if (request.method === "GET") {
    const decks = await env.DB.prepare(
      `
      SELECT fd.*, u.username as author,
        (SELECT COUNT(*) FROM flashcards WHERE deck_id = fd.id AND is_deleted = 0) as card_count
      FROM flashcard_decks fd
      LEFT JOIN users u ON fd.created_by = u.id
      ORDER BY fd.created_at DESC
    `,
    ).all();
    return json({ decks: decks.results }, 200, request);
  }

  if (request.method === "POST") {
    const user = await requireUser(request, env);
    const { title, category, description } = await request.json();
    if (!title || !category)
      return json({ error: "Title and category required" }, 400, request);
    if (title.length > 200)
      return json({ error: "Title too long (max 200 chars)" }, 400, request);
    if (description && description.length > 500)
      return json({ error: "Description too long (max 500 chars)" }, 400, request);

    const result = await env.DB.prepare(
      "INSERT INTO flashcard_decks (title, category, description, created_by) VALUES (?, ?, ?, ?)",
    )
      .bind(title, category, description || null, user.id)
      .run();

    return json({ ok: true, id: result.meta.last_row_id }, 201, request);
  }
}

async function handleFlashcardDeck(request, env, deckId) {
  if (request.method === "GET") {
    const deck = await env.DB.prepare(
      `
      SELECT fd.*, u.username as author
      FROM flashcard_decks fd
      LEFT JOIN users u ON fd.created_by = u.id
      WHERE fd.id = ?
    `,
    )
      .bind(deckId)
      .first();
    if (!deck) return json({ error: "Deck not found" }, 404, request);

    const cards = await env.DB.prepare(
      "SELECT id, front, meaning, note FROM flashcards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at",
    )
      .bind(deckId)
      .all();

    // Get linked challenges
    const links = await env.DB.prepare(
      `
      SELECT cd.id, cd.title FROM deck_links dl
      JOIN challenge_decks cd ON dl.challenge_deck_id = cd.id
      WHERE dl.flashcard_deck_id = ?
    `,
    )
      .bind(deckId)
      .all();

    return json(
      { deck, cards: cards.results, linked_challenges: links.results },
      200,
      request,
    );
  }

  if (request.method === "PUT") {
    const user = await requireUser(request, env);
    await requireDeckOwner(env, "flashcard_decks", deckId, user);

    const { title, category, description } = await request.json();
    if (title && title.length > 200)
      return json({ error: "Title too long (max 200 chars)" }, 400, request);
    if (description && description.length > 500)
      return json({ error: "Description too long (max 500 chars)" }, 400, request);
    await env.DB.prepare(
      "UPDATE flashcard_decks SET title = COALESCE(?, title), category = COALESCE(?, category), description = COALESCE(?, description) WHERE id = ?",
    )
      .bind(title || null, category || null, description || null, deckId)
      .run();

    return json({ ok: true }, 200, request);
  }

  if (request.method === "DELETE") {
    const user = await requireUser(request, env);
    await requireDeckOwner(env, "flashcard_decks", deckId, user);

    // Delete children first — D1 enforces FK constraints
    await env.DB.prepare("DELETE FROM flashcards WHERE deck_id = ?")
      .bind(deckId)
      .run();
    await env.DB.prepare("DELETE FROM deck_links WHERE flashcard_deck_id = ?")
      .bind(deckId)
      .run();
    await env.DB.prepare("DELETE FROM flashcard_decks WHERE id = ?")
      .bind(deckId)
      .run();
    return json({ ok: true }, 200, request);
  }
}

async function handleFlashcardDeckCards(request, env, deckId) {
  const user = await requireUser(request, env);
  await requireDeckOwner(env, "flashcard_decks", deckId, user);

  const { front, meaning, note } = await request.json();
  if (!front || !meaning)
    return json({ error: "Front and meaning required" }, 400, request);

  const cardCount = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM flashcards WHERE deck_id = ? AND is_deleted = 0",
  )
    .bind(deckId)
    .first();
  const cardLimit = parseInt(env.MAX_CARDS_PER_DECK || "50", 10);
  if (cardCount.n >= cardLimit) {
    console.log(`[addFlashcard] deck ${deckId} at limit (${cardLimit})`);
    return json({ error: `Deck has reached the ${cardLimit}-card limit` }, 400, request);
  }

  if (front.length > 500)
    return json({ error: "Front too long (max 500 chars)" }, 400, request);
  if (meaning.length > 2000)
    return json({ error: "Meaning too long (max 2000 chars)" }, 400, request);
  if (note && note.length > 2000)
    return json({ error: "Note too long (max 2000 chars)" }, 400, request);

  const result = await env.DB.prepare(
    "INSERT INTO flashcards (deck_id, front, meaning, note) VALUES (?, ?, ?, ?)",
  )
    .bind(deckId, front, meaning, note || null)
    .run();

  return json({ ok: true, id: result.meta.last_row_id }, 201, request);
}

async function handleFlashcard(request, env, cardId) {
  const user = await requireUser(request, env);
  const card = await env.DB.prepare(
    `
    SELECT f.deck_id, fd.created_by FROM flashcards f
    JOIN flashcard_decks fd ON f.deck_id = fd.id WHERE f.id = ?
  `,
  )
    .bind(cardId)
    .first();
  if (!card) return json({ error: "Card not found" }, 404, request);
  if (card.created_by !== user.id && !isAdmin(user, env))
    return json({ error: "Not your deck" }, 403, request);

  if (request.method === "PUT") {
    const { front, meaning, note } = await request.json();
    if (front && front.length > 500)
      return json({ error: "Front too long (max 500 chars)" }, 400, request);
    if (meaning && meaning.length > 2000)
      return json({ error: "Meaning too long (max 2000 chars)" }, 400, request);
    if (note && note.length > 2000)
      return json({ error: "Note too long (max 2000 chars)" }, 400, request);
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
    return json({ ok: true }, 200, request);
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE flashcards SET is_deleted = 1 WHERE id = ?")
      .bind(cardId)
      .run();
    return json({ ok: true }, 200, request);
  }
}

// === Challenge Routes ===
async function handleChallengeDecks(request, env) {
  if (request.method === "GET") {
    const decks = await env.DB.prepare(
      `
      SELECT cd.*, u.username as author,
        (SELECT MAX(version) FROM challenge_versions WHERE deck_id = cd.id) as current_version,
        (SELECT card_count FROM challenge_versions WHERE deck_id = cd.id ORDER BY version DESC LIMIT 1) as card_count
      FROM challenge_decks cd
      LEFT JOIN users u ON cd.created_by = u.id
      ORDER BY cd.created_at DESC
    `,
    ).all();
    return json({ decks: decks.results }, 200, request);
  }

  if (request.method === "POST") {
    const user = await requireUser(request, env);
    const { title, category, description, article, linked_flashcard_deck_id } =
      await request.json();
    if (!title || !category)
      return json({ error: "Title and category required" }, 400, request);
    if (title.length > 200)
      return json({ error: "Title too long (max 200 chars)" }, 400, request);
    if (description && description.length > 500)
      return json({ error: "Description too long (max 500 chars)" }, 400, request);

    const result = await env.DB.prepare(
      "INSERT INTO challenge_decks (title, category, description, article, created_by) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(title, category, description || null, article || null, user.id)
      .run();

    const challengeId = result.meta.last_row_id;

    // Create deck link if flashcard deck specified
    if (linked_flashcard_deck_id) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO deck_links (flashcard_deck_id, challenge_deck_id, created_by) VALUES (?, ?, ?)",
      )
        .bind(linked_flashcard_deck_id, challengeId, user.id)
        .run();
    }

    return json({ ok: true, id: challengeId }, 201, request);
  }
}

async function handleChallengeDeck(request, env, deckId) {
  if (request.method === "GET") {
    const deck = await env.DB.prepare(
      `
      SELECT cd.*, u.username as author
      FROM challenge_decks cd
      LEFT JOIN users u ON cd.created_by = u.id
      WHERE cd.id = ?
    `,
    )
      .bind(deckId)
      .first();
    if (!deck) return json({ error: "Deck not found" }, 404, request);

    // Get latest version
    const version = await env.DB.prepare(
      "SELECT * FROM challenge_versions WHERE deck_id = ? ORDER BY version DESC LIMIT 1",
    )
      .bind(deckId)
      .first();

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

    // Get unpublished cards (not in any version)
    const allCards = await env.DB.prepare(
      "SELECT id, question, choices, answer FROM challenge_cards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at",
    )
      .bind(deckId)
      .all();

    // Get linked flashcard decks
    const links = await env.DB.prepare(
      `
      SELECT fd.id, fd.title FROM deck_links dl
      JOIN flashcard_decks fd ON dl.flashcard_deck_id = fd.id
      WHERE dl.challenge_deck_id = ?
    `,
    )
      .bind(deckId)
      .all();

    return json(
      {
        deck,
        version,
        cards: cards,
        all_cards: allCards.results,
        linked_flashcard_decks: links.results,
      },
      200,
      request,
    );
  }

  if (request.method === "PUT") {
    const user = await requireUser(request, env);
    await requireDeckOwner(env, "challenge_decks", deckId, user);

    const body = await request.json();
    const { title, category, description, article } = body;

    if (title && title.length > 200)
      return json({ error: "Title too long (max 200 chars)" }, 400, request);
    if (description && description.length > 500)
      return json({ error: "Description too long (max 500 chars)" }, 400, request);

    await env.DB.prepare(
      `UPDATE challenge_decks
       SET title       = COALESCE(?, title),
           category    = COALESCE(?, category),
           description = COALESCE(?, description),
           article     = ?
       WHERE id = ?`,
    )
      .bind(title || null, category || null, description || null, article || null, deckId)
      .run();

    // Only update the deck link when the caller explicitly includes the field.
    // Omitting linked_flashcard_deck_id (e.g. article-only updates from AI confirm)
    // leaves the existing link untouched — prevents silently wiping it.
    if ("linked_flashcard_deck_id" in body) {
      const { linked_flashcard_deck_id } = body;
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

    return json({ ok: true }, 200, request);
  }

  if (request.method === "DELETE") {
    const user = await requireUser(request, env);
    await requireDeckOwner(env, "challenge_decks", deckId, user);

    // Delete scores first — they reference challenge_versions (no CASCADE in schema)
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
    await env.DB.prepare("DELETE FROM challenge_decks WHERE id = ?")
      .bind(deckId)
      .run();
    return json({ ok: true }, 200, request);
  }
}

async function handleChallengeDeckCards(request, env, deckId) {
  const user = await requireUser(request, env);
  await requireDeckOwner(env, "challenge_decks", deckId, user);

  const { question, choices, answer } = await request.json();
  if (!question || !choices || answer === undefined) {
    return json(
      { error: "Question, choices, and answer required" },
      400,
      request,
    );
  }
  if (!Array.isArray(choices) || choices.length !== 4) {
    return json({ error: "Exactly 4 choices required" }, 400, request);
  }
  if (answer < 0 || answer > 3) {
    return json({ error: "Answer must be 0-3" }, 400, request);
  }

  const cardCount = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM challenge_cards WHERE deck_id = ? AND is_deleted = 0",
  )
    .bind(deckId)
    .first();
  const questionLimit = parseInt(env.MAX_QUESTIONS_PER_DECK || "50", 10);
  if (cardCount.n >= questionLimit) {
    console.log(`[addChallengeCard] deck ${deckId} at limit (${questionLimit})`);
    return json({ error: `Deck has reached the ${questionLimit}-question limit` }, 400, request);
  }

  if (question.length > 500)
    return json({ error: "Question too long (max 500 chars)" }, 400, request);
  if (choices.some((c) => c.length > 300))
    return json({ error: "Choice too long (max 300 chars each)" }, 400, request);

  const result = await env.DB.prepare(
    "INSERT INTO challenge_cards (deck_id, question, choices, answer) VALUES (?, ?, ?, ?)",
  )
    .bind(deckId, question, JSON.stringify(choices), answer)
    .run();

  return json({ ok: true, id: result.meta.last_row_id }, 201, request);
}

async function handleChallengeCard(request, env, cardId) {
  const user = await requireUser(request, env);
  const card = await env.DB.prepare(
    `
    SELECT c.deck_id, cd.created_by FROM challenge_cards c
    JOIN challenge_decks cd ON c.deck_id = cd.id WHERE c.id = ?
  `,
  )
    .bind(cardId)
    .first();
  if (!card) return json({ error: "Card not found" }, 404, request);
  if (card.created_by !== user.id && !isAdmin(user, env))
    return json({ error: "Not your deck" }, 403, request);

  if (request.method === "PUT") {
    const { question, choices, answer } = await request.json();
    if (choices && (!Array.isArray(choices) || choices.length !== 4)) {
      return json({ error: "Exactly 4 choices required" }, 400, request);
    }
    if (answer !== undefined && (typeof answer !== "number" || answer < 0 || answer > 3)) {
      return json({ error: "Answer must be 0-3" }, 400, request);
    }
    if (question && question.length > 500)
      return json({ error: "Question too long (max 500 chars)" }, 400, request);
    if (choices && choices.some((c) => c.length > 300))
      return json({ error: "Choice too long (max 300 chars each)" }, 400, request);
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
    return json({ ok: true }, 200, request);
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(
      "UPDATE challenge_cards SET is_deleted = 1 WHERE id = ?",
    )
      .bind(cardId)
      .run();
    return json({ ok: true }, 200, request);
  }
}

async function handlePublish(request, env, deckId) {
  const user = await requireUser(request, env);
  await requireDeckOwner(env, "challenge_decks", deckId, user);

  // Get all active cards
  const cards = await env.DB.prepare(
    "SELECT id FROM challenge_cards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at",
  )
    .bind(deckId)
    .all();

  if (cards.results.length < 3) {
    return json({ error: "Need at least 3 cards to publish" }, 400, request);
  }

  const cardIds = cards.results.map((c) => c.id);
  // Compute version number inside the INSERT to avoid a race condition
  // between concurrent publish requests.
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

  return json(
    { ok: true, version: newVersion.version, card_count: cardIds.length },
    201,
    request,
  );
}

// === Score & Leaderboard Routes ===
async function handleScore(request, env) {
  const user = await requireUser(request, env);
  const { challenge_version_id, score, total } = await request.json();

  if (!challenge_version_id || score === undefined || total === undefined) {
    return json(
      { error: "challenge_version_id, score, and total required" },
      400,
      request,
    );
  }

  // Verify version exists and get the real card count
  const version = await env.DB.prepare(
    "SELECT id, card_count FROM challenge_versions WHERE id = ?",
  )
    .bind(challenge_version_id)
    .first();
  if (!version) return json({ error: "Version not found" }, 404, request);

  if (score < 0 || score > total)
    return json({ error: "Invalid score" }, 400, request);
  if (total !== version.card_count)
    return json({ error: "Invalid total" }, 400, request);

  await env.DB.prepare(
    `INSERT INTO scores (user_id, challenge_version_id, score, total)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, challenge_version_id)
     DO UPDATE SET score = excluded.score, total = excluded.total, created_at = datetime('now')
     WHERE CAST(excluded.score AS REAL) / excluded.total > CAST(scores.score AS REAL) / scores.total`,
  )
    .bind(user.id, challenge_version_id, score, total)
    .run();

  return json({ ok: true }, 201, request);
}

async function handleLeaderboard(request, env, versionId) {
  const scores = await env.DB.prepare(
    `
    SELECT s.score, s.total, s.created_at, u.username,
           ROUND(s.score * 100.0 / s.total) as percentage
    FROM scores s
    JOIN users u ON s.user_id = u.id
    WHERE s.challenge_version_id = ?
    ORDER BY percentage DESC, s.created_at ASC
    LIMIT 50
  `,
  )
    .bind(versionId)
    .all();

  const version = await env.DB.prepare(
    `
    SELECT cv.*, cd.title as deck_title
    FROM challenge_versions cv
    JOIN challenge_decks cd ON cv.deck_id = cd.id
    WHERE cv.id = ?
  `,
  )
    .bind(versionId)
    .first();

  return json({ version, scores: scores.results }, 200, request);
}

async function handleLeaderboardSummary(request, env) {
  // Single query: latest version per deck + top 3 scores via window function
  const rows = await env.DB.prepare(
    `
    WITH latest_versions AS (
      SELECT cv.id, cv.deck_id, cv.version, cv.card_count
      FROM challenge_versions cv
      WHERE cv.version = (
        SELECT MAX(version) FROM challenge_versions WHERE deck_id = cv.deck_id
      )
    ),
    ranked_scores AS (
      SELECT
        s.challenge_version_id,
        u.username,
        s.score,
        s.total,
        ROUND(s.score * 100.0 / s.total) AS percentage,
        ROW_NUMBER() OVER (
          PARTITION BY s.challenge_version_id
          ORDER BY ROUND(s.score * 100.0 / s.total) DESC, s.created_at ASC
        ) AS rn
      FROM scores s
      JOIN users u ON s.user_id = u.id
    )
    SELECT
      cd.id AS deck_id,
      cd.title,
      lv.id AS version_id,
      lv.version,
      lv.card_count,
      rs.username,
      rs.score,
      rs.total,
      rs.percentage,
      rs.rn
    FROM challenge_decks cd
    JOIN latest_versions lv ON lv.deck_id = cd.id
    LEFT JOIN ranked_scores rs ON rs.challenge_version_id = lv.id AND rs.rn <= 3
    ORDER BY cd.created_at DESC, rs.rn ASC
  `,
  ).all();

  // Group rows by deck, only include decks that have at least one score
  const deckMap = new Map();
  for (const row of rows.results) {
    if (!deckMap.has(row.deck_id)) {
      deckMap.set(row.deck_id, {
        deck_id: row.deck_id,
        title: row.title,
        version: row.version,
        version_id: row.version_id,
        card_count: row.card_count,
        top3: [],
      });
    }
    if (row.username !== null) {
      deckMap.get(row.deck_id).top3.push({
        username: row.username,
        score: row.score,
        total: row.total,
        percentage: row.percentage,
      });
    }
  }

  const summary = [...deckMap.values()].filter((d) => d.top3.length > 0);
  return json({ summary }, 200, request);
}

// === Deck Link Routes ===
async function handleDeckLinks(request, env) {
  if (request.method === "POST") {
    const user = await requireUser(request, env);
    const { flashcard_deck_id, challenge_deck_id } = await request.json();
    if (!flashcard_deck_id || !challenge_deck_id) {
      return json({ error: "Both deck IDs required" }, 400, request);
    }

    await env.DB.prepare(
      "INSERT OR IGNORE INTO deck_links (flashcard_deck_id, challenge_deck_id, created_by) VALUES (?, ?, ?)",
    )
      .bind(flashcard_deck_id, challenge_deck_id, user.id)
      .run();

    return json({ ok: true }, 201, request);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const fcId = url.searchParams.get("flashcard_deck_id");
    const chId = url.searchParams.get("challenge_deck_id");

    let links;
    if (fcId) {
      links = await env.DB.prepare(
        `
        SELECT dl.id, cd.id as challenge_deck_id, cd.title
        FROM deck_links dl JOIN challenge_decks cd ON dl.challenge_deck_id = cd.id
        WHERE dl.flashcard_deck_id = ?
      `,
      )
        .bind(fcId)
        .all();
    } else if (chId) {
      links = await env.DB.prepare(
        `
        SELECT dl.id, fd.id as flashcard_deck_id, fd.title
        FROM deck_links dl JOIN flashcard_decks fd ON dl.flashcard_deck_id = fd.id
        WHERE dl.challenge_deck_id = ?
      `,
      )
        .bind(chId)
        .all();
    } else {
      return json(
        { error: "Provide flashcard_deck_id or challenge_deck_id" },
        400,
        request,
      );
    }

    return json({ links: links.results }, 200, request);
  }
}

async function handleDeckLinkDelete(request, env, linkId) {
  const user = await requireUser(request, env);
  const query = isAdmin(user, env)
    ? env.DB.prepare("DELETE FROM deck_links WHERE id = ?").bind(linkId)
    : env.DB.prepare("DELETE FROM deck_links WHERE id = ? AND created_by = ?").bind(linkId, user.id);
  await query.run();
  return json({ ok: true }, 200, request);
}

// === AI Settings Routes ===

async function handleAISettings(request, env) {
  const user = await requireUser(request, env);
  const rate = await checkRateLimit(user, env);
  return json({ usage: { used: rate.used, limit: rate.limit } }, 200, request);
}

// === AI Generation Routes ===

async function handleGenerateFlashcards(request, env) {
  const user = await requireUser(request, env);
  const { article, count, frontHint, meaningHint, noteHint } =
    await request.json();

  if (!article || typeof article !== "string") {
    return json({ error: "Article text is required" }, 400, request);
  }
  if (article.length > 10000) {
    return json(
      { error: "Article too long (max 10,000 characters)" },
      400,
      request,
    );
  }
  const n = parseInt(count);
  if (!n || n < 1 || n > 30) {
    return json({ error: "Count must be between 1 and 30" }, 400, request);
  }

  const rate = await checkRateLimit(user, env);
  if (rate.limited) {
    return json(
      {
        error: `Daily AI generation limit reached (${rate.used}/${rate.limit}).`,
      },
      429,
      request,
    );
  }

  const frontDesc = frontHint || "a word or phrase from the article";
  const meaningDesc = meaningHint || "a clear definition or explanation";
  const noteDesc = noteHint || "an example sentence using the word";

  const messages = [
    {
      role: "system",
      content: `You are a flashcard generator. Create vocabulary flashcards from the given text.
You MUST respond with ONLY a valid JSON array. No explanation, no markdown, no code fences.
Each object must have exactly these 3 keys: "front", "meaning", "note".
- "front": ${frontDesc}
- "meaning": ${meaningDesc}
- "note": ${noteDesc}

Example output for 2 cards:
[{"front":"ephemeral","meaning":"lasting for a very short time","note":"The ephemeral beauty of cherry blossoms."},{"front":"ubiquitous","meaning":"present everywhere","note":"Smartphones are ubiquitous in modern life."}]`,
    },
    {
      role: "user",
      content: `Generate exactly ${n} flashcards from this article. Respond with ONLY a JSON array:\n\n${article}`,
    },
  ];

  const cards = await callAI(messages, validateFlashcards, env);
  await logUsage(user, "generate-flashcards", env);
  return json({ cards }, 200, request);
}

async function handleGenerateVocab(request, env) {
  const user = await requireUser(request, env);
  const { cards, article, count, hint } = await request.json();

  const n = parseInt(count);
  if (!n || n < 1 || n > 30) {
    return json({ error: "Count must be between 1 and 30" }, 400, request);
  }
  if (!cards && !article) {
    return json({ error: "Provide either cards or article" }, 400, request);
  }
  if (cards && (!Array.isArray(cards) || cards.length > 50)) {
    return json({ error: "Cards must be an array of at most 50 items" }, 400, request);
  }
  if (article && typeof article === "string" && article.length > 10000) {
    return json(
      { error: "Article too long (max 10,000 characters)" },
      400,
      request,
    );
  }

  const rate = await checkRateLimit(user, env);
  if (rate.limited) {
    return json(
      {
        error: `Daily AI generation limit reached (${rate.used}/${rate.limit}).`,
      },
      429,
      request,
    );
  }

  let messages;
  if (cards && Array.isArray(cards) && cards.length > 0) {
    messages = [
      {
        role: "system",
        content: `You are a vocabulary quiz generator. Create multiple-choice questions from the given flashcards.
Auto-detect which language is being learned (the "front" side) and generate questions accordingly.
${hint ? `Additional instruction from user: ${hint}\n` : ""}You MUST respond with ONLY a valid JSON array. No explanation, no markdown, no code fences.
Each object must have exactly these 3 keys: "question", "choices" (array of exactly 4 strings), "answer" (integer 0-3).

Example output for 1 question:
[{"question":"What does 'ephemeral' mean?","choices":["Lasting forever","Lasting a very short time","Very large","Extremely rare"],"answer":1}]`,
      },
      {
        role: "user",
        content: `Generate exactly ${n} vocabulary quiz questions from these flashcards. Respond with ONLY a JSON array:\n\n${JSON.stringify(cards)}`,
      },
    ];
  } else {
    messages = [
      {
        role: "system",
        content: `You are a vocabulary quiz generator. Extract key vocabulary from the article and create multiple-choice questions.
${hint ? `Additional instruction from user: ${hint}\n` : ""}You MUST respond with ONLY a valid JSON array. No explanation, no markdown, no code fences.
Each object must have exactly these 3 keys: "question", "choices" (array of exactly 4 strings), "answer" (integer 0-3).

Example output for 1 question:
[{"question":"What does 'ephemeral' mean?","choices":["Lasting forever","Lasting a very short time","Very large","Extremely rare"],"answer":1}]`,
      },
      {
        role: "user",
        content: `Generate exactly ${n} vocabulary quiz questions from this article. Respond with ONLY a JSON array:\n\n${article}`,
      },
    ];
  }

  const questions = await callAI(messages, validateChallengeCards, env);
  await logUsage(user, "generate-vocab", env);
  return json({ questions: shuffleChoices(questions) }, 200, request);
}

async function handleGenerateComprehension(request, env) {
  const user = await requireUser(request, env);
  const { article, count, hint } = await request.json();

  if (!article || typeof article !== "string") {
    return json({ error: "Article text is required" }, 400, request);
  }
  if (article.length > 10000) {
    return json(
      { error: "Article too long (max 10,000 characters)" },
      400,
      request,
    );
  }
  const n = parseInt(count);
  if (!n || n < 1 || n > 30) {
    return json({ error: "Count must be between 1 and 30" }, 400, request);
  }

  const rate = await checkRateLimit(user, env);
  if (rate.limited) {
    return json(
      {
        error: `Daily AI generation limit reached (${rate.used}/${rate.limit}).`,
      },
      429,
      request,
    );
  }

  const messages = [
    {
      role: "system",
      content: `You are a reading comprehension quiz generator. Create questions about meaning, main idea, inference, and details from the given article.
${hint ? `Additional instruction from user: ${hint}\n` : ""}You MUST respond with ONLY a valid JSON array. No explanation, no markdown, no code fences.
Each object must have exactly these 3 keys: "question", "choices" (array of exactly 4 strings), "answer" (integer 0-3).

Example output for 1 question:
[{"question":"What is the main idea of the passage?","choices":["Option A","Option B","Option C","Option D"],"answer":2}]`,
    },
    {
      role: "user",
      content: `Generate exactly ${n} comprehension questions from this article. Respond with ONLY a JSON array:\n\n${article}`,
    },
  ];

  const questions = await callAI(messages, validateChallengeCards, env);
  await logUsage(user, "generate-comprehension", env);
  return json({ questions: shuffleChoices(questions) }, 200, request);
}

// === Router ===
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      // Auth routes
      if (path === "/auth/login" && method === "POST")
        return await handleLogin(request, env);
      if (path === "/auth/verify" && method === "GET")
        return await handleVerify(request, env);
      if (path === "/auth/github" && method === "GET")
        return await handleGitHubAuth(request, env);
      if (path === "/auth/github/callback" && method === "GET")
        return await handleGitHubCallback(request, env);
      if (path === "/auth/me" && method === "GET")
        return await handleMe(request, env);
      if (path === "/auth/logout" && method === "POST")
        return await handleLogout(request, env);

      // Flashcard deck routes
      if (
        path === "/api/flashcard-decks" &&
        (method === "GET" || method === "POST")
      ) {
        return await handleFlashcardDecks(request, env);
      }
      let match = path.match(/^\/api\/flashcard-decks\/(\d+)$/);
      if (match)
        return await handleFlashcardDeck(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/flashcard-decks\/(\d+)\/cards$/);
      if (match && method === "POST")
        return await handleFlashcardDeckCards(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/flashcards\/(\d+)$/);
      if (match) return await handleFlashcard(request, env, parseInt(match[1]));

      // Challenge deck routes
      if (
        path === "/api/challenge-decks" &&
        (method === "GET" || method === "POST")
      ) {
        return await handleChallengeDecks(request, env);
      }
      match = path.match(/^\/api\/challenge-decks\/(\d+)$/);
      if (match)
        return await handleChallengeDeck(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/challenge-decks\/(\d+)\/cards$/);
      if (match && method === "POST")
        return await handleChallengeDeckCards(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/challenge-decks\/(\d+)\/publish$/);
      if (match && method === "POST")
        return await handlePublish(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/challenge-cards\/(\d+)$/);
      if (match)
        return await handleChallengeCard(request, env, parseInt(match[1]));

      // Score & Leaderboard
      if (path === "/api/scores" && method === "POST")
        return await handleScore(request, env);
      if (path === "/api/leaderboard-summary" && method === "GET")
        return await handleLeaderboardSummary(request, env);

      match = path.match(/^\/api\/leaderboard\/(\d+)$/);
      if (match && method === "GET")
        return await handleLeaderboard(request, env, parseInt(match[1]));

      // Deck links
      if (
        path === "/api/deck-links" &&
        (method === "GET" || method === "POST")
      ) {
        return await handleDeckLinks(request, env);
      }
      match = path.match(/^\/api\/deck-links\/(\d+)$/);
      if (match && method === "DELETE")
        return await handleDeckLinkDelete(request, env, parseInt(match[1]));

      // AI routes
      if (path === "/api/ai/settings" && method === "GET") {
        return await handleAISettings(request, env);
      }
      if (path === "/api/ai/generate-flashcards" && method === "POST") {
        return await handleGenerateFlashcards(request, env);
      }
      if (path === "/api/ai/generate-vocab" && method === "POST") {
        return await handleGenerateVocab(request, env);
      }
      if (path === "/api/ai/generate-comprehension" && method === "POST") {
        return await handleGenerateComprehension(request, env);
      }

      return json({ error: "Not found" }, 404, request);
    } catch (err) {
      if (err.status) return json({ error: err.message }, err.status, request);
      console.error(err);
      return json({ error: "Internal server error" }, 500, request);
    }
  },
};
