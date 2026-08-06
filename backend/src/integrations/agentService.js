// The agent service, over HTTP.
//
// Transport only. This file builds a request, proves the response is an answer
// to it, and translates the wire's snake_case into the shapes the rest of the
// Worker speaks. It holds no policy: no quota, no allowlist, no deck ownership,
// no word resolution, no `saveFailed`. Those stay in services/tutor.js for the
// same reason the tool allowlist is enforced where tools run — a second caller
// must not be able to skip them.
//
// It lives in integrations/ rather than services/ because that is what this
// repo means by the word: outbound third-party HTTP, like resend.js, github.js
// and hskMcp.js. See docs/architecture.md §7.1.
//
// TWO LAYERS OF DISTRUST, AND THIS IS ONLY THE FIRST.
//
// What is checked here is the ENVELOPE and the STRUCTURE: right contract, right
// request, fields of the right type and within bounds. What is deliberately NOT
// checked here is everything that needs state this file does not have — whether
// a `word_ref` points at a real word, whether a deck belongs to the caller,
// whether `save_words_to_deck` was even offered this turn. services/tutor.js
// re-derives all of that from its own trusted copies.
//
// The division matters: a client that validated policy would invite the service
// layer to trust its output, and the service layer is the only place that
// actually knows the answers.

import { AppError, badGateway } from "../services/errors.js";

const CONTRACT_VERSION = "1";

// Bounded well inside the client-facing request rather than at the agent's own
// pace.
//
// The tutor is enrichment: http/routes/zh.js already degrades to the cards when
// it fails, so a timeout that fires here costs the prose and nothing else. Left
// longer, Cloudflare's edge cuts the connection first and the learner gets an
// error page instead of the answer their lookup already produced. Losing the
// tutor is a soft failure; losing the request is not.
const DEFAULT_TIMEOUT_MS = 25_000;

const ACTION_TYPES = new Set(["save_words_to_deck", "create_activity"]);
const ACTIVITY_TYPES = new Set(["stroke", "match"]);
const STOP_REASONS = new Set(["answered", "step_limit", "model_error", "answered_after_cap"]);

// Mirrors the caps in services/agent-service/app/schemas.py. Both sides bound
// the same things, because either side may be the one talking to something
// unexpected.
const MAX_ACTIONS = 4;
const MAX_STEPS = 6;
const MAX_DISCOVERED_WORDS = 24;
const MAX_MESSAGE_CHARS = 4000;

/** Whether the remote tutor can be called at all. The flag decides whether it should be. */
export const isConfigured = (env) => Boolean(env.AGENT_SERVICE_URL);

// Every failure carries why.
//
// services/tutor.js reads `.reason` to decide what a failure costs: a timeout
// has already spent the request's time budget, so retrying locally makes the
// learner wait twice, while a fast transport error costs nothing to retry. One
// generic error cannot express that difference, and the route's `unavailable`
// reporting hides it from the logs as well.
function fail(reason, message) {
  const err = badGateway(message);
  err.reason = reason;
  return err;
}

/**
 * One tutor turn, run remotely.
 *
 * @returns {Promise<{
 *   message: string,
 *   intendedActions: object[],
 *   discoveredWords: string[],
 *   saveAttempts: number,
 *   stoppedBy: string,
 *   steps: {tool: string, ok: boolean}[],
 *   usage: {modelCalls: number, inputTokens: number, outputTokens: number},
 * }>}
 */
export async function runTurn(env, { messages, knownWords = [], decks = [], allowedTools, level = null }) {
  const base = env.AGENT_SERVICE_URL;
  if (!base) throw badGateway("The agent service is not configured");

  // Generated here, next to the code that checks it comes back. A response that
  // cannot prove which request it answers is discarded — under shadow mode two
  // turns are genuinely in flight at once, and "the wrong one" is a failure
  // mode that looks like a working system.
  const requestId = crypto.randomUUID();

  const body = JSON.stringify({
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    messages,
    known_words: knownWords,
    decks,
    allowed_tools: allowedTools,
    level,
  });

  const headers = { "Content-Type": "application/json" };
  // Absent locally, required in production — the service itself refuses to
  // serve on Cloud Run without it, so a missing secret fails loudly at the far
  // end rather than quietly here.
  if (env.AGENT_SERVICE_SECRET) headers["X-MyDeck-Agent-Secret"] = env.AGENT_SERVICE_SECRET;

  const timeout = Number(env.AGENT_SERVICE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  let res;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/internal/agent/turn`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;

    // AbortSignal.timeout rejects with a TimeoutError. Distinguished from every
    // other transport fault because it is the one that already cost the request
    // its time.
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";

    // Logged before it is generalised. The route reports `unavailable` to the
    // learner by design, so without this line a dead container, a wrong URL and
    // a timeout are indistinguishable from quota exhaustion.
    console.error(`[agent] request failed (${err?.name ?? "error"}): ${err?.message ?? err}`);

    throw timedOut
      ? fail("timeout", `The tutor did not answer within ${timeout}ms`)
      : fail("transport", "The tutor is unavailable right now");
  }

  if (!res.ok) {
    console.error(`[agent] service answered ${res.status}`);
    throw fail("status", `Agent service error (${res.status})`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw fail("unreadable", "The agent service returned unreadable data");
  }

  return validate(payload, requestId);
}

/**
 * The envelope, and the shape inside it.
 *
 * Everything rejected here is rejected outright rather than repaired. A
 * response that does not match the contract is not a response with a typo in
 * it; it is something other than the service this Worker thinks it is talking
 * to, and guessing at its meaning is how a boundary stops being one.
 */
function validate(payload, requestId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw fail("shape", "The agent service returned an unexpected shape");

  if (payload.contract_version !== CONTRACT_VERSION)
    throw fail("contract", `Agent contract mismatch (got ${payload.contract_version})`);

  if (payload.request_id !== requestId)
    throw fail("mismatch", "The agent service answered a different request");

  return {
    message: text(payload.message, MAX_MESSAGE_CHARS),
    intendedActions: actions(payload.intended_actions),
    discoveredWords: words(payload.discovered_words),
    saveAttempts: count(payload.save_attempts),
    stoppedBy: STOP_REASONS.has(payload.stopped_by) ? payload.stopped_by : "answered",
    steps: steps(payload.steps),
    usage: {
      modelCalls: count(payload.usage?.model_calls),
      inputTokens: count(payload.usage?.input_tokens),
      outputTokens: count(payload.usage?.output_tokens),
    },
  };
}

// An unknown action type is a hard failure, not a silent skip.
//
// Dropping it would mean a service asking for something this Worker does not
// implement gets a 200 and a reply implying it happened. The one case that
// matters most — a type nobody here has heard of — is exactly the one a filter
// would hide.
function actions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_ACTIONS) throw fail("shape", "The agent service asked for too many actions");

  return list.map((action) => {
    if (!action || typeof action !== "object" || !ACTION_TYPES.has(action.type))
      throw fail("shape", `Unknown agent action: ${action?.type}`);

    // Refs stay integers all the way through. The words they stand for are
    // resolved by services/tutor.js against the list it built itself, which is
    // the whole point of sending indices rather than characters.
    const wordRefs = refs(action.word_refs);

    if (action.type === "save_words_to_deck")
      return {
        type: action.type,
        wordRefs,
        deckId: optionalId(action.deck_id),
        deckName: action.deck_name == null ? null : text(action.deck_name, 60),
      };

    if (!ACTIVITY_TYPES.has(action.activity_type))
      throw fail("shape", `Unknown activity type: ${action.activity_type}`);

    return {
      type: action.type,
      activityType: action.activity_type,
      wordRefs,
      deckId: optionalId(action.deck_id),
      level: optionalLevel(action.level),
      title: action.title == null ? null : text(action.title, 60),
    };
  });
}

function refs(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((n) => {
    if (!Number.isInteger(n) || n < 0) throw fail("shape", `Bad word reference: ${n}`);
    return n;
  });
}

// Han only, and short enough to be a word — the same rule
// services/zh/conversation.js applies to words the browser sends back, for the
// same reason. These are re-resolved against the index before anything is done
// with them, so a corrupted character costs one dropped word.
const WORD = /^\p{Script=Han}{1,8}$/u;

function words(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const candidate of list) {
    const word = typeof candidate === "string" ? candidate.trim() : "";
    if (WORD.test(word) && !out.includes(word)) out.push(word);
    if (out.length === MAX_DISCOVERED_WORDS) break;
  }
  return out;
}

function steps(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .slice(0, MAX_STEPS)
    .filter((s) => s && typeof s.tool === "string")
    .map((s) => ({ tool: s.tool.slice(0, 64), ok: Boolean(s.ok) }));
}

function text(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function optionalId(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function optionalLevel(value) {
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : null;
}

export const AGENT_CONTRACT = { CONTRACT_VERSION, DEFAULT_TIMEOUT_MS, MAX_ACTIONS };
