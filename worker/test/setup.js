import { beforeEach } from "vitest";
import { env } from "cloudflare:test";
import schemaSql from "../schema.sql?raw";

// Split schema.sql into individual statements.
// Comments are stripped first; the schema has no semicolons inside literals,
// so a plain split on ";" is safe here.
const statements = schemaSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

// Child tables first so foreign key references are gone before their parents.
const TABLES = [
  "scores",
  "challenge_versions",
  "challenge_cards",
  "deck_links",
  "flashcards",
  "challenge_decks",
  "flashcard_decks",
  "ai_usage_log",
  "users",
];

// Reset explicitly rather than relying on storage isolation: every test starts
// with an empty database and no live sessions, so tests cannot leak into
// each other through unique constraints or stale KV keys.
beforeEach(async () => {
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }

  for (const table of TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  // Restart AUTOINCREMENT counters so ids are predictable per test.
  try {
    await env.DB.prepare("DELETE FROM sqlite_sequence").run();
  } catch {
    // sqlite_sequence only exists once an AUTOINCREMENT insert has happened.
  }

  const { keys } = await env.SESSIONS.list();
  for (const key of keys) {
    await env.SESSIONS.delete(key.name);
  }
});
