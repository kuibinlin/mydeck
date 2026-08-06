// The tutor turn.
//
// One request in, one painted answer out, in two layers.
//
// The CARDS are resolved deterministically and are never metered — a learner
// who has spent their daily AI allowance must still be able to look up a word.
// The TUTOR runs on top and is metered (per model call, inside tutor.respond).
//
// The ordering is the design: the lookup already answers the question without a
// model, so the agent can only make the answer richer, never make it absent.
// Every failure below degrades to the cards rather than to an error.

import { json } from "../respond.js";
import { readBody } from "../body.js";
import { requireUser } from "../session.js";
import { classify } from "../../services/zh/classify.js";
import { candidates, resolveMany } from "../../services/zh/resolve.js";
import { meta } from "../../services/zh/localIndex.js";
import * as tutor from "../../services/tutor.js";
import { summariseResult } from "../../services/activities.js";

// A paste, not a book. Long enough for any paragraph a learner is working
// through, short enough that no single request is expensive.
const MAX_MESSAGE_CHARS = 4000;

// Background work, as a plain function.
//
// `ctx` is a runtime object and stops here. services/ takes (env, args) and
// nothing else — that is what lets a route, an agent tool and a test all call
// tutor.respond without one of them faking an ExecutionContext. Same reasoning
// as ai/agentLoop.js taking `execute` as a bound function rather than the
// registry.
//
// Absent (a test, a tool) the work is simply not scheduled, which is the right
// default: shadow mode is an observation, and an observation that cannot be
// backgrounded should not run on the learner's request instead.
const background = (ctx) =>
  typeof ctx?.waitUntil === "function" ? ctx.waitUntil.bind(ctx) : null;

export async function turn(request, env, _params, ctx) {
  const user = await requireUser(request, env);

  const { message: rawMessage, activityResult, level, context } = await readBody(request, {});

  // Bounded before anything reads it. Unbounded, one POST drives an O(4n) scan
  // in wordsIn() and then goes into a model prompt — a megabyte of text is a
  // CPU-limit 500 and a token bill, from a single request. The sibling AI route
  // has capped article text since it shipped; this endpoint needs the same.
  const message =
    typeof rawMessage === "string" ? rawMessage.slice(0, MAX_MESSAGE_CHARS) : rawMessage;

  // The learner picks this in the empty state and it persists across visits.
  // It decides what "give me some words" means, so a wrong one is worse than
  // none — hence the clamp rather than a pass-through.
  const hskLevel = Math.min(Math.max(Math.round(Number(level)) || 0, 0), 7) || null;

  // An activity finishing is a turn the learner did not type. It runs the same
  // agent as a message would, because reacting to a score is the same job as
  // answering a question — and routing it separately would duplicate the quota,
  // the loop and the response shape for no gain.
  // Passed through unbounded on purpose — tutor.respond bounds it, so every
  // caller gets the same limits rather than the ones this route remembered.
  if (activityResult)
    return respondToResult(request, env, user, activityResult, hskLevel, context, ctx);

  const classification = classify(message);

  // Nothing to look up: an empty box, or a language this tab does not do.
  // Both are answered honestly and instantly rather than sent anywhere.
  if (classification.kind === "empty" || classification.kind === "foreign_cjk") {
    return json(
      {
        kind: classification.kind,
        cards: [],
        agent: null,
        dataset: meta.datasetVersion,
      },
      200,
      request,
    );
  }

  const words = candidates(classification);
  const cards = await resolveMany(env, words);

  // The tutor is enrichment, and enrichment is allowed to fail. Out of quota,
  // model down, loop capped — the cards are already a complete answer, so the
  // reply is the same shape either way and the learner loses only the prose.
  let agent = null;
  try {
    agent = await tutor.respond(env, {
      user,
      message,
      seed: cards,
      level: hskLevel,
      context,
      waitUntil: background(ctx),
    });
  } catch (err) {
    console.warn(`[zh] tutor unavailable: ${err?.message ?? err}`);
    agent = { text: "", unavailable: true, reason: err?.status === 429 ? "quota" : "error" };
  }

  return json(
    {
      kind: classification.kind,
      cards,
      // Tiers actually used, so the client can say "dictionary is busy" rather
      // than pretending, and so degradation is visible in logs.
      sources: [...new Set(cards.map((c) => c.source))],
      agent,
      dataset: meta.datasetVersion,
    },
    200,
    request,
  );
}

/**
 * The learner finished an activity.
 *
 * The client sends the activity it was given back alongside the numbers, so the
 * summary can be built against a word list this server produced rather than
 * whatever the request claims. See services/activities.js#summariseResult for
 * why that clamp is the load-bearing part.
 */
async function respondToResult(request, env, user, payload, level, context, ctx) {
  const { activity, ...data } = payload ?? {};
  const summary = summariseResult(activity, data);

  let agent = null;
  try {
    agent = await tutor.respond(env, {
      user,
      message: summary.text,
      seed: [],
      level,
      context,
      waitUntil: background(ctx),
    });
  } catch (err) {
    console.warn(`[zh] tutor unavailable after activity: ${err?.message ?? err}`);
    agent = { text: "", unavailable: true, reason: err?.status === 429 ? "quota" : "error" };
  }

  return json(
    {
      kind: "activity_result",
      cards: [],
      // Echoed back so the client can render the same numbers it sent without
      // trusting its own copy of them — these are the clamped ones.
      score: summary.score,
      misses: summary.misses,
      // The line the model was actually given. An activity turn has no typed
      // question, so without this the client has no `q` to replay and the
      // exchange would go back as a reply to nothing.
      prompt: summary.text,
      agent,
      dataset: meta.datasetVersion,
    },
    200,
    request,
  );
}
