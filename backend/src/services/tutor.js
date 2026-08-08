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
// MODEL OVERRIDE. The model that writes clean JSON and the model that can hold a
// tool call are not the same model, on either provider tried. Cloudflare's
// gemma-sea-lion rejects a request carrying tools outright (3030 / 8001), and
// SEA-LION's Gemma accepts one and then answers from memory without calling
// anything — which is the worse failure, because the reply looks fine while
// every character in it came from the model rather than the dictionary. So the
// tutor picks its own model (AI_TUTOR_MODEL) and leaves AI_MODEL, which
// flashcard and quiz generation use, alone.

import { runAgent } from "../ai/agentLoop.js";
import { activeProvider } from "../ai/callModel.js";
import * as registry from "../tools/registry.js";
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

// Which implementation answers this turn.
//
// Read here rather than at the route for the same reason the allowlist and the
// context bound are: `respond` has two callers — a typed message and a finished
// activity (http/routes/zh.js) — and a selection made at one of them would
// silently leave the other on the old path.
//
// PRECEDENCE. Enabled beats shadow. Running both when the remote path is
// already authoritative spends two turns of model budget to compare a result
// against the thing it replaced, which is the one combination with no value.
//
// The allowlist is keyed on EMAIL, matching ADMIN_EMAILS in ai/usage.js — the
// only other per-user gate in the codebase. Empty means nobody, deliberately:
// the failure mode of "empty means everybody" is the whole user base moved onto
// an unproven path by a config line that looks inert.
const truthy = (v) => String(v ?? "").trim().toLowerCase() === "true";

const allowlist = (v) =>
  String(v ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export function agentMode(env, user) {
  if (!agentService.isConfigured(env)) return "local";

  const allowed = allowlist(env.AGENT_ALLOWED_USERS);
  if (!allowed.includes(String(user?.email ?? "").toLowerCase())) return "local";

  if (truthy(env.AGENT_ENABLED)) return "remote";
  if (truthy(env.AGENT_SHADOW)) return "shadow";
  return "local";
}

// Per-provider defaults for the tool-capable model, used when AI_TUTOR_MODEL is
// unset. There is no single default that is right everywhere, because "can hold
// a tool call" is a per-model property and the provider only narrows it.
//
// SEA-LION arrives through the `openai` provider (it is OpenAI-compatible, so
// AI_BASE_URL points at it), which is why there is no SEA-LION entry here — the
// key would be "openai" and would then be wrong for actual OpenAI. Deployments
// on SEA-LION set AI_TUTOR_MODEL explicitly; wrangler.toml does.
const TUTOR_MODEL_DEFAULTS = {
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
};

// Falls through to null rather than to AI_MODEL, deliberately. AI_MODEL is
// chosen for structured JSON — on both providers tried so far that is a model
// that will not hold a tool call (Cloudflare's gemma-sea-lion rejects the
// request outright, 3030/8001; SEA-LION's Gemma accepts it and then answers
// from memory with no tool call at all, which is worse because it looks like it
// worked). null lets resolveProvider pick the provider default, and a wrong
// model is loud where a silently-toolless one is not.
function tutorModel(env) {
  return env.AI_TUTOR_MODEL || TUTOR_MODEL_DEFAULTS[activeProvider(env)] || null;
}

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
 * Computed in one place so both implementations get it — the remote path
 * inherited this hole from the local one, and a fix in either alone would
 * leave the other lying.
 */
const saveMissing = (text, attempts, saves) =>
  saves.length === 0 && (attempts > 0 || claimsSave(text));

const SYSTEM = [
  "You are a patient Chinese tutor inside a flashcard app called MyDeck.",
  "",
  "Answer in English unless the learner writes in Chinese. Keep replies to two or three",
  "sentences — a word card is already on screen beside you, so do not restate its pinyin,",
  "level or meaning. Say the thing the card cannot: what the word is for, when to use it,",
  "what it is confused with.",
  "",
  "Never state a pinyin, tone, HSK level, frequency or measure word that did not come from",
  "a tool. If the learner names a word that is not already listed as looked up, call",
  "hsk_lookup before saying anything about it. Only say a word is not in the HSK vocabulary",
  "list when a tool actually reported found:false — never as a guess, and never because you",
  "skipped the lookup. Do not apologise for it.",
  "",
  "Never ask a clarifying question. Pick a sensible default and say in a few words what you",
  "picked.",
  "",
  "Saying a deck was created or updated does not make it so — only calling save_words_to_deck",
  "writes anything. If you did not call it, offer to save rather than reporting a save.",
  "",
  "Anything you save goes to a private draft deck only the learner can see. Never say it is",
  "published, shared or public, and never offer to publish it — that is their click to make.",
].join("\n");

/**
 * One turn.
 *
 * `seed` is the deterministic lookup already rendered on screen. It enters the
 * conversation as a tool result so the model reads the characters instead of
 * retyping them.
 *
 * `waitUntil` is a bound function, not an ExecutionContext — see
 * http/routes/zh.js. Absent, shadow mode simply does not run.
 */
export async function respond(env, {
  user,
  message,
  seed = [],
  level = null,
  context = null,
  waitUntil = null,
}) {
  const rate = await checkRateLimit(user, env);
  if (rate.limited)
    throw tooManyRequests(
      `Daily AI limit reached (${rate.used}/${rate.limit}). Word lookups and your decks still work.`,
    );

  const turn = prepare({ message, seed, context });
  const mode = agentMode(env, user);

  if (mode === "remote") {
    try {
      return await runRemote(env, { user, message, level, ...turn });
    } catch (err) {
      // FAILURE-TYPE-SPECIFIC, because the two failures cost different things.
      //
      // A timeout has already spent the request's budget. Running the local
      // loop after it makes the learner wait a second time for a turn that was
      // already too slow, so it is rethrown and http/routes/zh.js degrades to
      // the cards — which is a complete answer and the behaviour that path was
      // designed and tested for.
      //
      // A transport error or a malformed response failed fast and cost almost
      // nothing, so falling through to the local loop is cheap and keeps the
      // tutor working for the one account this is switched on for.
      if (err?.reason === "timeout") {
        console.warn(`[agent] remote timeout, degrading to cards: ${err?.message ?? err}`);
        throw err;
      }
      console.warn(`[agent] remote fallback (${err?.reason ?? "error"}): ${err?.message ?? err}`);
    }
  }

  const answer = await runLocal(env, { user, message, level, ...turn });

  // Scheduled, never awaited. The learner already has their answer; this is an
  // observation about a path that is not serving them yet.
  if (mode === "shadow" && waitUntil)
    waitUntil(shadow(env, { user, message, level, ...turn }, answer));

  return answer;
}

/**
 * Everything both implementations need, derived once.
 *
 * Bounded here rather than at the route, for the same reason the tool allowlist
 * is enforced here: a second caller must not be able to skip it.
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

/** The JavaScript agent loop. Authoritative until docs/architecture.md §11 step 8. */
async function runLocal(env, { user, message, level, seed, history, offered, resolved, priorKnown }) {
  const tools = registry.select(offered);

  // Activities are the one tool result the client needs in full — everything
  // else is context for the model. Captured as they run rather than dug out of
  // the transcript afterwards.
  const activities = [];

  // Same reason: the client shows the deck it can now open, and the model gets
  // a sentence about it.
  const saves = [];

  // Counted so the client can contradict the model. Measured: told the save had
  // failed twice, it still said "I've added it to your private deck." Prose is
  // not evidence of a write, so the block renders from `saves` and says so
  // plainly when a save was attempted and none survived.
  let saveAttempts = 0;

  // Words the dictionary returned this turn, in the order they arrived. Trusted
  // for the same reason the seed is: these characters came from the index, not
  // from the model.
  const fromTools = [];

  // Every Chinese word this turn has correct characters for, in the order the
  // learner met them: what they typed, then what an activity was built from,
  // then whatever a lookup produced. This is the save tool's real source — see
  // the wrapper below.
  const knownWords = () => {
    const out = [];
    const push = (w) => {
      if (w && !out.includes(w)) out.push(w);
    };
    for (const card of seed) if (card.found) push(card.word);
    for (const activity of activities) for (const item of activity.items) push(item.word);
    for (const word of fromTools) push(word);
    // Earlier turns last, because order is priority: saveWords keeps the first
    // MAX_SAVE and drops the rest, so "save that" has to mean the word just
    // discussed rather than the oldest one still in the conversation.
    for (const word of priorKnown) push(word);
    return out;
  };

  // The HSK tools project to { w } for lists and { word } for a single lookup.
  const harvest = (result) => {
    if (result?.found && result.word) fromTools.push(result.word);
    for (const item of result?.words ?? []) if (item?.w) fromTools.push(item.w);
  };

  const execute = (name, args) => {
    // Counted before the allowlist check rather than after it.
    //
    // `saveFailed` is the only thing in the app that can contradict a model
    // claiming it saved, and it is gated on this counter. Incrementing after
    // the refusal below made the signal unreachable in precisely the case it
    // exists for: a model reaching for a tool it was never offered got a
    // refusal nobody counted, so the learner saw the claim and nothing else.
    if (name === "save_words_to_deck") saveAttempts++;

    // The allowlist has to be enforced here, not just handed to the model.
    //
    // `registry.select()` only decides what is ADVERTISED. `registry.execute()`
    // resolves a name against the whole registry, so a model that emits a name
    // it was never offered — trained-in, hallucinated, or steered there by
    // pasted text — reaches it. That made every withheld tool live, including
    // `publish_flashcard_deck`, which three separate comments in this codebase
    // claimed was out of reach. An allowlist you do not check is documentation.
    if (!offered.includes(name)) {
      console.warn(`[tutor] refused tool outside the allowlist: ${name}`);
      return Promise.resolve({ ok: false, error: `Unknown tool: ${name}` });
    }

    // The prompt asks the model not to re-look-up a seeded word. Measured: it
    // does anyway. So the instruction is enforced here instead of requested
    // there — a prompt is advice, this is a guarantee.
    //
    // Two things it buys. The round trip and its share of the shared rate
    // budget, and the guarantee that a word the learner typed is answered from
    // the characters they actually typed rather than the model's copy of them.
    if (name === "hsk_lookup") {
      const hit = resolved.get(String(args?.word ?? "").trim());
      if (hit) {
        return Promise.resolve({
          ok: true,
          result: {
            word: hit.word,
            found: true,
            pinyin: hit.pinyin,
            meanings: [hit.meaning],
            level: hit.level,
            note: "Already looked up for this message.",
          },
        });
      }
    }

    // "Make me a game" carries no level, so the service would fall to HSK 1 and
    // hand an intermediate learner 的 了 我 是. The learner already answered this
    // question in the empty state; filling it in here means their answer holds
    // whether or not the model thought to pass it on.
    let filled =
      name === "create_activity" && level && !args?.level && !args?.words && !args?.deckId
        ? { ...args, level }
        : args;

    // The model cannot type Chinese. Measured this phase: asked to save 医院 it
    // produced 疒館, then 疒馆; asked for food words, 飯物. Not one character
    // survived the round trip.
    //
    // So the save tool never reads characters from the model. `knownWords()` is
    // the only source: what the learner typed, what an activity was built from,
    // what a lookup returned, then what earlier turns carried — all of it from
    // the index or their own keyboard.
    //
    // Naming `words` therefore SELECTS from that list rather than supplying it.
    // Trusting the names verbatim was the bug: a single corrupted character
    // meant every word failed to resolve and the save threw, so asking to save
    // 书 saved nothing at all. A name matching nothing real is a typo by
    // definition, and falling back to the whole list is the better answer — it
    // is the same private draft either way, and saving one word too many beats
    // saving none. Naming nothing still means "what we have been discussing".
    if (name === "save_words_to_deck") {
      const known = knownWords();
      const asked = Array.isArray(filled?.words) ? filled.words : [];
      const chosen = asked.map((w) => String(w ?? "").trim()).filter((w) => known.includes(w));
      filled = { ...filled, words: chosen.length ? chosen : known };
    }

    return registry.execute(name, env, { user, resolved }, filled).then((outcome) => {
      if (outcome.ok && name.startsWith("hsk_")) harvest(outcome.result);

      if (name === "save_words_to_deck" && outcome.ok) {
        saves.push(outcome.result);
        const { added, skipped, duplicates, title } = outcome.result;
        return {
          ok: true,
          result: {
            saved: added.length,
            deck: title,
            // Reported so the model can tell the learner rather than claim a
            // clean save. A skipped word means characters that did not resolve,
            // which is exactly the thing worth saying out loud.
            skipped: skipped.length ? skipped : undefined,
            alreadyThere: duplicates.length ? duplicates : undefined,
            note:
              "Saved as a private draft and now on screen. Say what was saved in one sentence, " +
              "mention anything skipped, and do not offer to publish it.",
          },
        };
      }

      if (name === "create_activity" && outcome.ok) {
        activities.push(outcome.result);
        // The model gets a summary, not the item list. It does not need to read
        // twelve words back to write a sentence about them, and feeding them in
        // is both context it will not use and characters it might corrupt.
        return {
          ok: true,
          result: {
            created: outcome.result.type,
            title: outcome.result.title,
            count: outcome.result.items.length,
            note: "The activity is now on screen. Introduce it in one sentence; do not list the words.",
          },
        };
      }
      return outcome;
    });
  };

  // ONE system message, and it comes first.
  //
  // The seed used to be pushed as a second system message *after* the learner's
  // turn. Cloudflare's llama accepted that; SEA-LION's gateway rejects the whole
  // request — "System message must be at the beginning.", HTTP 400 — so every
  // tutor turn failed while lookups kept working, which is a hard failure that
  // looks like a soft one. Independently of any provider, an instruction placed
  // after the message it is meant to govern is the weaker position for it.
  const system = [
    level
      ? `${SYSTEM}\n\nThe learner is studying at HSK level ${level}. Pitch examples there, and ` +
        `pass level:${level} when you ask for words without naming them.`
      : SYSTEM,
  ];

  if (seed.length) {
    system.push(
      "Already looked up for this message — use these exact characters and facts, and do " +
        "not call hsk_lookup for them again:\n" +
        JSON.stringify(seed.map(compact)),
    );
  }

  // The loop's repeat-call guard is per-run, so it cannot see that an activity
  // named in an earlier turn was already built. Said here instead.
  if (history.length) {
    system.push(
      "The turns above are context. Whatever they mention is already on the learner's screen — " +
        "answer what was just asked, and do not rebuild an activity or re-save words because " +
        "they appear earlier in the conversation.",
    );
  }

  // History sits between the system message and the current one: the system
  // message stays first (see above), and the learner's actual question stays
  // last, which is where every model weights hardest.
  const messages = [
    { role: "system", content: system.join("\n\n") },
    ...history,
    { role: "user", content: message },
  ];

  let calls = 0;
  const result = await runAgent(messages, {
    env,
    tools: registry.toOpenAI(tools),
    execute,
    model: tutorModel(env),
    // One usage row per model call, not per request. A four-step run costs
    // four generations and the learner's balance should say so.
    onStep: () => {
      calls++;
    },
  });

  for (let i = 0; i < calls; i++) await logUsage(user, "tutor", env);

  return {
    text: result.text,
    steps: result.steps.map((s) => ({ tool: s.tool, ok: s.ok })),
    stoppedBy: result.stoppedBy,
    activities,
    saves,
    // True when the learner has no cards and the reply implies otherwise —
    // whether the model tried and failed, or never tried and said it had. The
    // client says so rather than letting the reply be the only account.
    saveFailed: saveMissing(result.text, saveAttempts, saves),
    // Always false on this path, and that is not an oversight.
    //
    // Here a failed create_activity comes back to the model as {ok:false,
    // error:"a matching game needs at least 4 words with distinct meanings"} and
    // it writes a sentence about it. The remote path executes actions after the
    // loop, so the model cannot know — which is exactly the gap this flag fills.
    // Setting it here too would put a banner underneath prose that already said
    // the same thing.
    activityFailed: false,
  };
}

// The seed goes into a prompt, so it pays context. Only the fields a tutor
// would actually mention.
const compact = (c) => ({
  w: c.word,
  py: c.pinyin || undefined,
  en: c.meaning || undefined,
  lv: c.level ?? undefined,
  found: c.found,
});

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

// Tagged so respond() can tell a fast failure from a spent one. Same class as a
// malformed response: the service is broken, not the request.
function invalid(detail) {
  const err = badGateway(`The agent service returned an invalid action: ${detail}`);
  err.reason = "policy";
  return err;
}

async function runRemote(env, { user, message, level, seed, history, offered, resolved, priorKnown }) {
  const text = String(message ?? "").trim();
  // The schema requires a message, so an empty one would come back a 422 after
  // a round trip. Fail here instead and let the local loop take it.
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

  // One row per model call, not per request — the same accounting the local
  // path uses, sourced one process away. Logged before the actions are
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
 * conversation. Same ordering as knownWords() on the local path.
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
 * this must not quietly narrow that rule for the local path. It narrows what a
 * remote process can ask for, which is a different question.
 *
 * Costs one D1 read per remote turn that the local path only pays when a tool
 * runs. Accepted: it is what removes the guess that made the model invent a
 * deck id in Phase 0.
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
  // Same order and same reasoning as knownWords() on the local path.
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

  for (const action of response.intendedActions) {
    if (action.deckId !== null && !deckIds.has(action.deckId))
      throw invalid(`deck ${action.deckId} was not offered this turn`);

    const named = wordsFromRefs(action.wordRefs, knownWords);

    if (action.type === "save_words_to_deck") {
      // Counted before the allowlist check, never after.
      //
      // saveFailed is the only thing that can contradict a model claiming it
      // saved, and it is gated on this count. The local path learned that the
      // hard way (see execute() above): counting after the refusal made the
      // signal unreachable in exactly the case it exists for.
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

/**
 * Shadow mode.
 *
 * The learner already has the JavaScript answer. This runs the remote path
 * beside it and writes down how they differed — and does nothing else. No
 * actions are materialised, no usage row is written, and every failure is
 * swallowed, because a background observation must not be able to affect a
 * response that has already been sent.
 *
 * It costs the account's AI budget, not the learner's quota: Workers AI's
 * 10,000 neurons/day is account-wide. Shadow your own account only.
 */
async function shadow(env, { user, message, level, seed, history, offered, resolved, priorKnown }, local) {
  const started = Date.now();

  try {
    const text = String(message ?? "").trim();
    if (!text) return;

    const remote = await agentService.runTurn(env, {
      messages: [...history, { role: "user", content: text }],
      knownWords: buildKnownWords(seed, priorKnown, resolved),
      decks: await deckContext(env, user),
      allowedTools: offered,
      level,
    });

    console.log(`[agent:shadow] ${JSON.stringify(diff(local, remote, Date.now() - started))}`);
  } catch (err) {
    console.warn(`[agent:shadow] ${err?.reason ?? "error"}: ${err?.message ?? err}`);
  }
}

/**
 * What the two paths did, side by side.
 *
 * Metadata only. Two runs of the same model on the same prompt do not produce
 * the same sentence, so comparing prose as strings would report a mismatch on
 * every single turn and mean nothing — lengths are the most that is worth
 * recording until there is something specific to look for.
 *
 * `remoteMs` is not a comparison. The remote call runs after the response has
 * been sent, so it is wall clock for that call alone and cannot be read against
 * the local path's inline latency.
 */
function diff(local, remote, remoteMs) {
  return {
    stoppedBy: [local.stoppedBy, remote.stoppedBy],
    stepCount: [local.steps.length, remote.steps.length],
    tools: [local.steps.map((s) => s.tool), remote.steps.map((s) => s.tool)],
    saveAttempts: [local.saveFailed || local.saves.length > 0, remote.saveAttempts > 0],
    localWrites: { saves: local.saves.length, activities: local.activities.length },
    remoteActions: remote.intendedActions.map((a) => a.type),
    remoteWordRefs: remote.intendedActions.map((a) => a.wordRefs),
    textLength: [local.text.length, remote.message.length],
    remoteModelCalls: remote.usage.modelCalls,
    remoteMs,
  };
}

export const TUTOR = {
  ALLOWED_TOOLS,
  TUTOR_MODEL_DEFAULTS,
  tutorModel,
  wantsToSave,
  claimsSave,
  agentMode,
  buildKnownWords,
};
