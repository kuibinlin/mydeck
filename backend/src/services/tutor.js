// The tutor turn: what the model is allowed to do, and what it already knows.
//
// Two decisions here carry most of the weight.
//
// PRE-SEEDING. The words the learner typed are resolved deterministically
// before the model runs, and injected as an already-executed tool result. This
// is not a latency trick. Phase 0 measured this model corrupting 3 of 7 Chinese
// characters when echoing them into tool arguments — 翻译 became 翰译, 改革
// became 攴革. A model that never retypes a character cannot corrupt one, and
// it also removes the single most common tool call from its job.
//
// THE MODEL IS NOT CHOSEN HERE, and the reason it once had to be is worth
// keeping. The model that writes clean JSON and the model that can hold a tool
// call are not the same model, on either provider tried: Cloudflare's
// gemma-sea-lion rejects a request carrying tools outright (3030 / 8001), and
// SEA-LION's Gemma accepts one and then answers from memory without calling
// anything — the worse failure, because the reply looks fine while every
// character in it came from the model rather than the dictionary. That
// requirement now belongs to services/agent-service, which reads its own
// AI_TUTOR_MODEL. AI_MODEL stays here for flashcard and quiz generation.

import { checkRateLimit, logUsage } from "../ai/usage.js";
import { boundContext } from "./zh/conversation.js";
import { lookupLocal } from "./zh/localIndex.js";
import { tooManyRequests, badGateway } from "./errors.js";
import * as agentService from "../integrations/agentService.js";
import * as activityService from "./activities.js";
import { saveWords } from "./deckSave.js";
import { listDecks } from "./flashcards.js";

// Publishing is absent on purpose: a draft is recoverable, making a deck public
// is not. It stays a human click.
const ALLOWED_TOOLS = [
  "hsk_lookup",
  "hsk_word_list",
  "hsk_search",
  "create_activity",
  "save_words_to_deck",
];

// The MODEL is no longer chosen here. services/agent-service picks it from its
// own AI_TUTOR_MODEL, and the Worker has no say — §8.4 permits the two AI paths
// to diverge, and after §11 step 9 there is no second path in this process to
// keep in step. What remains of AI_MODEL and ai/providers/ serves the
// non-agentic endpoints (§4), which never moved.

// The save tool is only on the table when the learner asked for it.
//
// Measured, and the reason this gate exists: with every argument optional,
// save_words_to_deck became the cheapest call in the set and the model reached
// for it unprompted — two of three plain word lookups ("医院", "银行") created a
// deck nobody asked for. Writing to someone's data uninvited is not a rough
// edge, and no prompt wording reliably stops it.
//
// So intent is read here, from the learner's own words, and the tool simply is
// not offered otherwise. A missing tool cannot be called.
const SAVE_INTENT =
  /\b(save|saving|keep|store|remember|memoris|memoriz|bookmark|add (?:it|them|these|those|this)\b)/i;
const SAVE_INTENT_ZH = /收藏|保存|记住|存起来|加入/;

// Exported for the parity test in src/features/chinese/floorPlan.test.js: the
// chips are the only way most turns get sent, so a chip promising a save whose
// wording this predicate reads as "no" is a dead button. Pure function of a
// string — exporting it costs nothing.
export const wantsToSave = (message) => {
  const text = typeof message === "string" ? message : "";
  return SAVE_INTENT.test(text) || SAVE_INTENT_ZH.test(text);
};

// The model saying it saved something, when it did not call the tool at all.
//
// Measured on the first real run of the Python path, and the JavaScript path
// does the same thing: asked to save with the tool withheld, the model replied
// "I've saved 医院 to your private draft deck" having called nothing. The prompt
// tells it to offer rather than report in that case; it reported.
//
// `saveAttempts` cannot see this, because there was no attempt — so the learner
// got a claim with nothing in the app contradicting it. This is the other half
// of that signal: not "the save failed" but "the save never happened and you
// were told otherwise".
//
// PAST TENSE, because an offer is the correct answer here and must not trip it.
// "I can save that for you" and "Would you like me to add these?" are what the
// prompt asks for; "I've added them to your deck" is the lie.
// Two shapes, because a claim does not always name where it went. The first
// wants a deck noun nearby; the second catches the terse form — "Done! I've
// saved it." — which is plausible output and slipped through on its own.
const CLAIMED_SAVE = [
  /\b(saved|added|stored|kept|created|put)\b[^.!?]{0,60}\b(deck|flashcards?|collection)\b/i,
  /\b(saved|added)\s+(it|them|those|these|that)\b/i,
];

// Tense is not enough on its own: `put` is its own past tense, so "Shall I put
// them in a deck?" reads identically to a report. Modal framing settles it —
// whatever verb follows, this is an offer.
const OFFERING =
  /\b(shall|should|can|could|may|would|will|i'?ll|want me|like me)\b[^.!?]{0,40}\b(save|add|store|keep|creat|put)/i;

const CLAIMED_SAVE_ZH = /已(?:经)?(?:保存|添加|加入|存好|存入)/;

export const claimsSave = (text) => {
  const said = typeof text === "string" ? text : "";
  if (CLAIMED_SAVE_ZH.test(said)) return true;

  // Sentence by sentence, so one offer at the end cannot excuse a claim at the
  // start — "I've added them to your deck. Shall I save more?" is still a lie.
  return said
    .split(/[.!?\n]+/)
    .some(
      (sentence) =>
        CLAIMED_SAVE.some((pattern) => pattern.test(sentence)) && !OFFERING.test(sentence),
    );
};

/**
 * True when the learner ended up with nothing and was told otherwise.
 *
 * `saves.length === 0` is checked FIRST, and that ordering is what makes a
 * prose heuristic safe here: the flag can only ever fire when nothing was
 * saved, so "nothing was saved" is a true statement every time it appears. A
 * regex false positive costs a redundant line on a turn where nothing was
 * saved anyway; a false negative is only today's behaviour. Neither can put a
 * wrong claim on screen.
 *
 * Written for the JavaScript loop and kept when that loop was deleted: the
 * remote path had inherited the same hole, so this outlived the implementation
 * it was written against. It is the Worker's last word on a claimed save, and
 * the only one that does not depend on the service reporting honestly.
 */
const saveMissing = (text, attempts, saves) =>
  saves.length === 0 && (attempts > 0 || claimsSave(text));

// The system prompt lives in services/agent-service/app/agent/prompt.py and
// ONLY there.
//
// Until §11 step 9 it existed twice — once here for runLocal, once in Python —
// and services/agent-service/tests/test_prompt_parity.py pinned the copies
// together because a safety rule fixed in one language and forgotten in the
// other is worse than a rule in neither. It caught exactly that: the prompt
// told the model what to SAY when a lookup reported found:false but never that
// a lookup was required first, and both copies had it.
//
// Deleting the loop deletes the duplication, so that test goes with it. There
// is nothing left to diverge.

/**
 * One turn.
 *
 * `seed` is the deterministic lookup already rendered on screen. It crosses to
 * the agent as already-resolved words so the model reads the characters instead
 * of retyping them — this model corrupts Chinese it retypes (§7.2).
 *
 * There is ONE implementation now. §11 step 9 deleted the JavaScript loop:
 * `runLocal`, `ai/agentLoop.js`, `ai/toolMessages.js` and `tools/`. What is left
 * of this file is the Worker's half of §8.2 — the agent asks, the Worker
 * decides and writes.
 *
 * Which means every failure now costs the prose. Before, a transport error or a
 * malformed response fell through to the local loop and the learner never knew;
 * only a timeout degraded to the cards. Now they all do. That is not a
 * regression introduced casually — it is the point of the step, and the reason
 * it waited until the remote path had served real turns without one.
 *
 * The floor is still a complete answer: `routes/zh.js` renders the word cards
 * from the deterministic lookup, which never needed a model at all.
 */
export async function respond(env, {
  user,
  message,
  seed = [],
  level = null,
  context = null,
}) {
  const rate = await checkRateLimit(user, env);
  if (rate.limited)
    throw tooManyRequests(
      `Daily AI limit reached (${rate.used}/${rate.limit}). Word lookups and your decks still work.`,
    );

  const turn = prepare({ message, seed, context });

  // No URL, no tutor. This replaced AGENT_ENABLED, AGENT_SHADOW and
  // AGENT_ALLOWED_USERS, all of which existed to choose between two
  // implementations. With one, the only question left is whether it is
  // reachable — and an unset URL degrades to the cards rather than erroring,
  // which is what makes a local `wrangler dev` without the agent still useful.
  if (!agentService.isConfigured(env))
    throw badGateway("The tutor is not configured.", { reason: "unconfigured" });

  return runRemote(env, { user, message, level, ...turn });
}

/**
 * Everything a turn needs, derived once.
 *
 * Bounded here rather than at the route, for the same reason the tool allowlist
 * is enforced here: `respond` has two callers — a typed message and a finished
 * activity — and anything decided at one of them leaves the other behind.
 */
function prepare({ message, seed, context }) {
  const { history, words: priorWords } = boundContext(context);

  const offered = wantsToSave(message)
    ? ALLOWED_TOOLS
    : ALLOWED_TOOLS.filter((name) => name !== "save_words_to_deck");

  // Words already resolved for this message, keyed for interception below.
  const resolved = new Map(seed.filter((c) => c.found).map((c) => [c.word, c]));

  // Words from earlier turns, re-resolved against the bundled index — the
  // client says which words came up, the dictionary says what they are. This
  // turn's seed always wins, because the live server may have enriched it
  // beyond what the offline copy knows. A word that does not resolve is simply
  // not carried; there is nothing useful to do with characters we cannot read.
  const priorKnown = [];
  for (const word of priorWords) {
    if (resolved.has(word)) continue;
    const hit = lookupLocal(word);
    if (!hit?.meaning) continue;
    resolved.set(word, hit);
    priorKnown.push(word);
  }

  return { seed, history, offered, resolved, priorKnown };
}

// ---------------------------------------------------------------------------
// The remote path.
//
// The service reasons; this file decides and writes. Everything below exists to
// keep that true: the request carries only what the Worker itself resolved, and
// the response is treated as a proposal from a process on public ingress.
//
// integrations/agentService.js has already checked the envelope and the shape —
// right contract, right request, integers where integers belong. What is left is
// everything that needs state only this file holds, and it is exactly four
// things:
//
//   1. a word reference points inside the list we sent
//   2. and at an entry we actually resolved (found:true)
//   3. a deck id is one we offered this turn
//   4. a save was asked for by the learner, and a refusal still counts
//
// Nothing here re-checks bounds, action counts or types. Doing it twice reads
// as thoroughness and is really just two places to keep in step.
// ---------------------------------------------------------------------------

const MAX_DECKS = 50;
const MAX_KNOWN_WORDS = 32;

// Tagged `policy` like every other failure of this hop. Nothing branches on it
// — routes/zh.js catches them all and answers with the cards — but it is what
// separates "the model asked for something it was not allowed" from a timeout
// in `wrangler tail`. Same class as a malformed response: the service is
// broken, not the request.
function invalid(detail) {
  const err = badGateway(`The agent service returned an invalid action: ${detail}`);
  err.reason = "policy";
  return err;
}

async function runRemote(env, { user, message, level, seed, history, offered, resolved, priorKnown }) {
  const text = String(message ?? "").trim();
  // The schema requires a message, so an empty one would come back a 422 after
  // a round trip. Fail here instead — routes/zh.js degrades to the cards, which
  // is the whole answer for a turn with nothing to answer.
  if (!text) throw invalid("no message to answer");

  const knownWords = buildKnownWords(seed, priorKnown, resolved);
  const decks = await deckContext(env, user);

  const response = await agentService.runTurn(env, {
    messages: [...history, { role: "user", content: text }],
    knownWords,
    decks,
    allowedTools: offered,
    level,
  });

  // One row per model call, not per request. AI_DAILY_LIMIT_FREE is spent by a
  // four-step run four times as fast as by a one-step one, and the count comes
  // from the process that made the calls. Logged before the actions are
  // materialised because the calls happened either way; a response this Worker
  // then rejects still cost what it cost.
  for (let i = 0; i < response.usage.modelCalls; i++) await logUsage(user, "tutor", env);

  const done = await materialize(env, { user, level, response, knownWords, resolved, offered, decks });

  return {
    text: response.message,
    steps: response.steps,
    stoppedBy: response.stoppedBy,
    activities: done.activities,
    saves: done.saves,
    saveFailed: saveMissing(response.message, done.saveAttempts, done.saves),
    // The model asked for an activity and none was built. It cannot know — the
    // action ran after the loop ended — so this is the only thing that can say
    // so. Same job saveFailed does for a write.
    activityFailed: done.activityFailed,
  };
}

/**
 * The numbered list an action may refer to.
 *
 * Order is the contract: seeded words first, words carried from earlier turns
 * last. deckSave keeps the first MAX_SAVE and drops the rest, so "save that"
 * has to mean the word just discussed rather than the oldest one still in the
 * conversation.
 *
 * Words that missed are included with found:false, because the tutor still has
 * to be able to say a word is not in the HSK list. They cannot be referenced.
 */
function buildKnownWords(seed, priorKnown, resolved) {
  const words = [];

  const add = (entry) => {
    if (words.length >= MAX_KNOWN_WORDS) return;
    words.push({ ...entry, i: words.length });
  };

  for (const card of seed)
    add({
      simplified: String(card.word ?? "").slice(0, 32),
      pinyin: String(card.pinyin ?? "").slice(0, 64),
      meaning: String(card.meaning ?? "").slice(0, 200),
      level: hskLevel(card.level),
      found: Boolean(card.found),
      source: "seed",
    });

  for (const word of priorKnown) {
    const hit = resolved.get(word);
    add({
      simplified: String(word).slice(0, 32),
      pinyin: String(hit?.pinyin ?? "").slice(0, 64),
      meaning: String(hit?.meaning ?? "").slice(0, 200),
      level: hskLevel(hit?.level),
      found: true,
      source: "prior",
    });
  }

  return words;
}

const hskLevel = (v) => (Number.isInteger(v) && v >= 1 && v <= 7 ? v : null);

/**
 * The decks the agent may name.
 *
 * Only the learner's own, and only these — an id that did not come from here is
 * refused below. That is provenance, not ownership: services/activities.js
 * deliberately allows building practice from anyone's *published* deck, and
 * this does not narrow that rule. It narrows what a remote process may ask
 * for, which is a different question.
 *
 * Costs one D1 read on every turn, including the ones that name no deck.
 * Accepted: it is what removes the guess that made the model invent a deck id
 * in Phase 0.
 */
async function deckContext(env, user) {
  const decks = await listDecks(env, { user });
  return decks
    .filter((deck) => deck.created_by === user.id)
    .slice(0, MAX_DECKS)
    .map((deck) => ({
      id: deck.id,
      name: String(deck.title ?? "").slice(0, 120),
      card_count: deck.card_count ?? 0,
    }));
}

/**
 * Turn proposals into writes.
 *
 * Every action runs through the same service an HTTP route would call, so the
 * limits, the ownership checks and the re-resolution of every character all
 * happen exactly once and in one place. saveWords already re-resolves against
 * the index (services/deckSave.js) and already refuses a deck the learner does
 * not own; repeating either here would be a second copy to keep honest.
 */
async function materialize(env, { user, level, response, knownWords, resolved, offered, decks }) {
  const deckIds = new Set(decks.map((deck) => deck.id));
  const activities = [];
  const saves = [];
  let activityFailed = false;
  let requested = 0;

  // Words the run discovered through a tool. The service names them; the
  // dictionary says what they are, and one it cannot read is simply dropped —
  // the same treatment zh/conversation.js gives words the browser sends back.
  const discovered = [];
  for (const word of response.discoveredWords) {
    if (resolved.has(word)) continue;
    const hit = lookupLocal(word);
    if (!hit?.meaning) continue;
    resolved.set(word, hit);
    discovered.push(word);
  }

  // What "save what we've been discussing" means when an action names nothing.
  // Same order and same reasoning as buildKnownWords above.
  const pool = () => {
    const out = [];
    const push = (word) => {
      if (word && !out.includes(word)) out.push(word);
    };
    for (const entry of knownWords) if (entry.found && entry.source === "seed") push(entry.simplified);
    for (const activity of activities) for (const item of activity.items) push(item.word);
    for (const word of discovered) push(word);
    for (const entry of knownWords) if (entry.found && entry.source === "prior") push(entry.simplified);
    return out;
  };

  // EVERY action is checked before ANY of them runs.
  //
  // These two checks used to sit inside the loop below, which made the response
  // partially applied: a second action naming a deck we never offered threw
  // after the first had already written to D1. respond() throws, routes/zh.js
  // catches it and answers with the cards — so the learner got a normal-looking
  // reply and a deck in their account that nothing on screen mentions. Both
  // checks are pure and cheap; there is no reason for them to interleave with
  // writes.
  const planned = response.intendedActions.map((action) => {
    if (action.deckId !== null && !deckIds.has(action.deckId))
      throw invalid(`deck ${action.deckId} was not offered this turn`);
    return { action, named: wordsFromRefs(action.wordRefs, knownWords) };
  });

  for (const { action, named } of planned) {
    if (action.type === "save_words_to_deck") {
      // Counted before the allowlist check, never after.
      //
      // saveFailed is the only thing that can contradict a model claiming it
      // saved, and it is gated on this count. Measured: counting after the
      // refusal made the signal unreachable in exactly the case it exists for.
      // app/agent/run.py counts a withheld save for the same reason, one
      // process away.
      requested++;

      if (!offered.includes("save_words_to_deck")) {
        console.warn("[agent] refused save_words_to_deck — the learner did not ask to save");
        continue;
      }

      try {
        saves.push(
          await saveWords(env, {
            user,
            words: named.length ? named : pool(),
            deckId: action.deckId ?? undefined,
            deck: action.deckName ?? undefined,
            resolved,
          }),
        );
      } catch (err) {
        // A save that did not happen is reported by saveFailed, not by throwing
        // — the rest of the turn is still a usable answer.
        console.warn(`[agent] save failed: ${err?.message ?? err}`);
      }
      continue;
    }

    // The same gate, asked about whatever the action actually is.
    //
    // This branch used to execute without consulting `offered` at all. It was
    // harmless while create_activity was the one non-save tool and always on
    // the list — but "harmless because of what the list happens to contain
    // today" is not the property this check is for. The allowlist is enforced
    // where actions are materialised (§8.2), and that has to mean all of them.
    if (!offered.includes(action.type)) {
      console.warn(`[agent] refused ${action.type} — not offered this turn`);
      continue;
    }

    try {
      activities.push(
        await activityService.create(env, {
          user,
          type: action.activityType,
          words: named,
          deckId: action.deckId ?? undefined,
          // The learner answered this in the empty state; their answer holds
          // whether or not the model thought to pass it on.
          level: action.level ?? level,
          title: action.title ?? undefined,
        }),
      );
    } catch (err) {
      // activities.create throws for "no Han characters" and for a matching
      // game with too few distinct meanings. Caught, because letting it out
      // would cost the learner the tutor's whole reply over a failed game.
      console.warn(`[agent] activity failed: ${err?.message ?? err}`);
      activityFailed = true;
    }
  }

  return {
    activities,
    saves,
    // The larger of what the service reported and what it actually asked for. A
    // service that under-reports its own attempts must not be able to suppress
    // saveFailed by returning zero.
    saveAttempts: Math.max(response.saveAttempts, requested),
    activityFailed,
  };
}

/** An index into the list we sent, pointing at a word we actually resolved. */
function wordsFromRefs(refs, knownWords) {
  const out = [];
  for (const ref of refs) {
    const entry = knownWords[ref];
    if (!entry) throw invalid(`word reference ${ref} is outside the list we sent`);
    if (!entry.found) throw invalid(`word reference ${ref} names a word we could not resolve`);
    if (!out.includes(entry.simplified)) out.push(entry.simplified);
  }
  return out;
}



// Exported for tests. TUTOR_MODEL_DEFAULTS, tutorModel and agentMode went with
// §11 step 9 — the first two chose a model this process no longer calls, the
// third chose between implementations there is no longer a choice between.
export const TUTOR = {
  ALLOWED_TOOLS,
  wantsToSave,
  claimsSave,
  buildKnownWords,
};
