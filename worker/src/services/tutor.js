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
import { tooManyRequests } from "./errors.js";

// Publishing is absent on purpose: a draft is recoverable, making a deck public
// is not. It stays a human click.
const ALLOWED_TOOLS = [
  "hsk_lookup",
  "hsk_word_list",
  "hsk_search",
  "create_activity",
  "save_words_to_deck",
];

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

const wantsToSave = (message) => {
  const text = typeof message === "string" ? message : "";
  return SAVE_INTENT.test(text) || SAVE_INTENT_ZH.test(text);
};

const SYSTEM = [
  "You are a patient Chinese tutor inside a flashcard app called MyDeck.",
  "",
  "Answer in English unless the learner writes in Chinese. Keep replies to two or three",
  "sentences — a word card is already on screen beside you, so do not restate its pinyin,",
  "level or meaning. Say the thing the card cannot: what the word is for, when to use it,",
  "what it is confused with.",
  "",
  "Never state a pinyin, tone, HSK level, frequency or measure word that did not come from",
  "a tool. If a tool reports found:false, say the word is not in the HSK vocabulary list.",
  "Do not guess, and do not apologise for it.",
  "",
  "Never ask a clarifying question. Pick a sensible default and say in a few words what you",
  "picked.",
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
 */
export async function respond(env, { user, message, seed = [], level = null }) {
  const rate = await checkRateLimit(user, env);
  if (rate.limited)
    throw tooManyRequests(
      `Daily AI limit reached (${rate.used}/${rate.limit}). Word lookups and your decks still work.`,
    );

  const offered = wantsToSave(message)
    ? ALLOWED_TOOLS
    : ALLOWED_TOOLS.filter((name) => name !== "save_words_to_deck");

  const tools = registry.select(offered);

  // Words already resolved for this message, keyed for interception below.
  const resolved = new Map(seed.filter((c) => c.found).map((c) => [c.word, c]));

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
    return out;
  };

  // The HSK tools project to { w } for lists and { word } for a single lookup.
  const harvest = (result) => {
    if (result?.found && result.word) fromTools.push(result.word);
    for (const item of result?.words ?? []) if (item?.w) fromTools.push(item.w);
  };

  const execute = (name, args) => {
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
    // So the save tool does not read characters from the model at all when it
    // does not have to. Omitting `words` means "the words we have been talking
    // about", which is what the learner meant anyway, and those characters come
    // from the index and the learner's own keyboard. A word the model does name
    // still has to match something real, or it is dropped downstream.
    if (name === "save_words_to_deck") {
      saveAttempts++;
      const asked = Array.isArray(filled?.words) ? filled.words : [];
      if (!asked.length) filled = { ...filled, words: knownWords() };
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

  const messages = [
    { role: "system", content: system.join("\n\n") },
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
    // True when the model tried to save and nothing landed. The client says so
    // rather than letting the reply be the only account of what happened.
    saveFailed: saveAttempts > 0 && saves.length === 0,
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

export const TUTOR = { ALLOWED_TOOLS, TUTOR_MODEL_DEFAULTS, tutorModel, wantsToSave };
