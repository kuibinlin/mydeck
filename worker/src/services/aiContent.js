// AI-backed content generation.
//
// Sits in services/ rather than in a route handler so the same call is
// available to an HTTP request, an agent tool, or a test. Each function
// validates input, checks the caller's quota, prompts the model, records
// usage, and returns plain data.

import { badRequest, tooManyRequests } from "./errors.js";
import {
  generateStructured,
  validateFlashcards,
  validateChallengeCards,
  shuffleChoices,
  checkRateLimit,
  logUsage,
  prompts,
} from "../ai/index.js";

const MAX_ARTICLE_CHARS = 10000;
const MIN_COUNT = 1;
const MAX_COUNT = 30;
const MAX_SOURCE_CARDS = 50;

function assertArticle(article) {
  if (!article || typeof article !== "string")
    throw badRequest("Article text is required");
  if (article.length > MAX_ARTICLE_CHARS)
    throw badRequest(
      `Article too long (max ${MAX_ARTICLE_CHARS.toLocaleString("en-US")} characters)`,
    );
}

function assertCount(count) {
  const n = parseInt(count);
  if (!n || n < MIN_COUNT || n > MAX_COUNT)
    throw badRequest(`Count must be between ${MIN_COUNT} and ${MAX_COUNT}`);
  return n;
}

async function assertQuota(user, env) {
  const rate = await checkRateLimit(user, env);
  if (rate.limited)
    throw tooManyRequests(
      `Daily AI generation limit reached (${rate.used}/${rate.limit}).`,
    );
}

export async function getUsage(env, { user }) {
  const rate = await checkRateLimit(user, env);
  return { used: rate.used, limit: rate.limit };
}

export async function generateFlashcards(
  env,
  { user, article, count, frontHint, meaningHint, noteHint },
) {
  assertArticle(article);
  const n = assertCount(count);
  await assertQuota(user, env);

  const messages = prompts.flashcardsFromArticle({
    article,
    count: n,
    frontHint,
    meaningHint,
    noteHint,
  });

  const cards = await generateStructured(messages, validateFlashcards, env);
  await logUsage(user, "generate-flashcards", env);
  return { cards };
}

export async function generateVocab(env, { user, cards, article, count, hint }) {
  // Count is checked before the source so a malformed count is reported first,
  // matching what the frontend expects.
  const n = assertCount(count);
  if (!cards && !article) throw badRequest("Provide either cards or article");
  if (cards && (!Array.isArray(cards) || cards.length > MAX_SOURCE_CARDS))
    throw badRequest(
      `Cards must be an array of at most ${MAX_SOURCE_CARDS} items`,
    );
  if (article && typeof article === "string") assertArticle(article);
  await assertQuota(user, env);

  const messages =
    cards && Array.isArray(cards) && cards.length > 0
      ? prompts.vocabFromCards({ cards, count: n, hint })
      : prompts.vocabFromArticle({ article, count: n, hint });

  const questions = await generateStructured(
    messages,
    validateChallengeCards,
    env,
  );
  await logUsage(user, "generate-vocab", env);
  return { questions: shuffleChoices(questions) };
}

export async function generateComprehension(
  env,
  { user, article, count, hint },
) {
  assertArticle(article);
  const n = assertCount(count);
  await assertQuota(user, env);

  const messages = prompts.comprehensionFromArticle({
    article,
    count: n,
    hint,
  });

  const questions = await generateStructured(
    messages,
    validateChallengeCards,
    env,
  );
  await logUsage(user, "generate-comprehension", env);
  return { questions: shuffleChoices(questions) };
}
