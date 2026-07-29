// Score submission and leaderboard reads.

import { badRequest, notFound } from "./errors.js";

const LEADERBOARD_LIMIT = 50;
const TOP_N_PER_DECK = 3;

export async function submitScore(
  env,
  { user, challenge_version_id, score, total },
) {
  if (!challenge_version_id || score === undefined || total === undefined)
    throw badRequest("challenge_version_id, score, and total required");

  const version = await env.DB.prepare(
    "SELECT id, card_count FROM challenge_versions WHERE id = ?",
  )
    .bind(challenge_version_id)
    .first();
  if (!version) throw notFound("Version not found");

  if (score < 0 || score > total) throw badRequest("Invalid score");
  if (total !== version.card_count) throw badRequest("Invalid total");

  // Keep the player's best attempt: only overwrite when the new percentage
  // beats the stored one.
  await env.DB.prepare(
    `INSERT INTO scores (user_id, challenge_version_id, score, total)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, challenge_version_id)
     DO UPDATE SET score = excluded.score, total = excluded.total, created_at = datetime('now')
     WHERE CAST(excluded.score AS REAL) / excluded.total > CAST(scores.score AS REAL) / scores.total`,
  )
    .bind(user.id, challenge_version_id, score, total)
    .run();

  return { ok: true };
}

export async function getLeaderboard(env, { versionId }) {
  const scores = await env.DB.prepare(
    `SELECT s.score, s.total, s.created_at, u.username,
            ROUND(s.score * 100.0 / s.total) as percentage
     FROM scores s
     JOIN users u ON s.user_id = u.id
     WHERE s.challenge_version_id = ?
     ORDER BY percentage DESC, s.created_at ASC
     LIMIT ${LEADERBOARD_LIMIT}`,
  )
    .bind(versionId)
    .all();

  const version = await env.DB.prepare(
    `SELECT cv.*, cd.title as deck_title
     FROM challenge_versions cv
     JOIN challenge_decks cd ON cv.deck_id = cd.id
     WHERE cv.id = ?`,
  )
    .bind(versionId)
    .first();

  return { version, scores: scores.results };
}

export async function getLeaderboardSummary(env) {
  // One query: latest version per deck, plus that version's ranked scores.
  const rows = await env.DB.prepare(
    `WITH latest_versions AS (
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
     LEFT JOIN ranked_scores rs ON rs.challenge_version_id = lv.id AND rs.rn <= ${TOP_N_PER_DECK}
     ORDER BY cd.created_at DESC, rs.rn ASC`,
  ).all();

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

  // Decks nobody has played yet are not worth a leaderboard row.
  return [...deckMap.values()].filter((d) => d.top3.length > 0);
}
