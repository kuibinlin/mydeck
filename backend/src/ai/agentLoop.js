// The agent loop: call the model, run what it asks for, hand back the results,
// repeat until it answers.
//
// `execute` arrives as a bound function rather than the registry, so this file
// never sees the caller's identity and structurally cannot build one from model
// output. That is also why ai/ still imports nothing from services/ but errors.
//
// Caps, and why these numbers:
//
//   maxSteps 4      A model turn is ~1.5s to decide, ~6s to write prose. Four
//                   is ~16s worst case and covers the deepest real task
//                   (lookup → list → activity → answer). A model that has not
//                   converged by four is looping, not reasoning.
//   maxToolCalls 6  The dictionary's public endpoint allows 30 requests/minute
//                   across all users. This is the per-turn share of that.
//
// The loop never throws for a tool failure. registry.execute already returns
// {ok:false, error} precisely so a model can read "deck is full, pick another"
// and recover — discarding that would waste the design.

import { callModel, activeProvider } from "./callModel.js";
import { assistantToolMessage, toolResultMessages } from "./toolMessages.js";
import { badGateway } from "../services/errors.js";

export async function runAgent(messages, {
  env,
  tools = [],
  execute,
  model = null,
  maxSteps = 4,
  maxToolCalls = 6,
  onStep = null,
}) {
  const provider = activeProvider(env);
  const history = [...messages];
  const steps = [];

  // Keyed by name+args. A weak model's most common failure is asking for the
  // same thing twice; answering from here costs nothing and breaks the cycle.
  const seen = new Map();

  let toolCallCount = 0;
  let consecutiveFailures = 0;
  let text = "";
  let stoppedBy = "answered";

  for (let step = 0; step < maxSteps; step++) {
    // Past the tool budget, ask for prose and nothing else. Offering tools that
    // cannot be run invites a call that will be discarded.
    const offerTools = toolCallCount < maxToolCalls && consecutiveFailures < 2;

    let turn;
    try {
      turn = await callModel(history, { env, tools: offerTools ? tools : [], model });
    } catch (err) {
      // Logged, not swallowed. These catches used to be bare `catch {}`, which
      // discarded the only description of the failure that existed: the route
      // reports `unavailable` to the learner by design, so a dead model looked
      // identical to a model that was merely out of quota, and the actual
      // reason — wrong model name, no entitlement, expired dev credentials —
      // was unreachable from anywhere. Everything below still degrades exactly
      // as before; it just says why first.
      console.error(
        `[agent] model call failed (step ${step}, provider ${provider}, model ${model ?? env.AI_MODEL ?? "default"}): ${err?.message ?? err}`,
      );

      // A status means the provider already classified this and retrying cannot
      // help — the account's daily allowance is gone, or the model name is
      // wrong. Rethrown rather than retried, and rethrown *as itself* so the
      // route can tell the learner "today's allowance is used up" instead of
      // the generic "the tutor's notes aren't available", which reads as a
      // glitch and invites a retry that will fail identically. Same rule
      // generateStructured uses, for the same reason.
      if (err?.status) throw err;

      // One retry: openaiCompat deliberately throws status-less errors for
      // transient upstream faults.
      if (step === 0) {
        try {
          turn = await callModel(history, { env, tools: offerTools ? tools : [], model });
        } catch (retryErr) {
          console.error(`[agent] retry also failed: ${retryErr?.message ?? retryErr}`);
          throw badGateway("The tutor is unavailable right now");
        }
      } else {
        stoppedBy = "model_error";
        break;
      }
    }

    onStep?.({ index: step, usage: turn.usage, toolCalls: turn.toolCalls });

    if (turn.text) text = turn.text;

    if (!turn.toolCalls?.length) {
      stoppedBy = "answered";
      break;
    }

    const calls = turn.toolCalls.slice(0, maxToolCalls - toolCallCount);
    history.push(assistantToolMessage(provider, turn.text, calls));

    const results = [];
    let failedThisStep = 0;

    for (const call of calls) {
      const key = `${call.name}:${JSON.stringify(call.input ?? {})}`;

      if (seen.has(key)) {
        results.push({
          id: call.id,
          output: {
            error:
              "You already called this with the same arguments. The result is above — answer the learner now.",
          },
        });
        steps.push({ tool: call.name, args: call.input, ok: false, repeated: true });
        continue;
      }

      toolCallCount++;
      const outcome = await execute(call.name, call.input ?? {});
      seen.set(key, outcome);

      if (!outcome.ok) failedThisStep++;
      results.push({ id: call.id, output: outcome.ok ? outcome.result : { error: outcome.error } });
      steps.push({ tool: call.name, args: call.input, ok: outcome.ok, error: outcome.error });
    }

    consecutiveFailures = failedThisStep === calls.length ? consecutiveFailures + 1 : 0;
    history.push(...toolResultMessages(provider, results));

    if (step === maxSteps - 1) stoppedBy = "step_limit";
  }

  // A run that spent every step calling tools has no prose to show for it.
  // Measured: asking about 翻译 produced four tool calls and an empty reply,
  // which renders as a card with an unexplained silence beside it.
  //
  // So when the loop ends without an answer, ask for one — tools withheld, so
  // the only thing it can do is write. The results it gathered are real and
  // already in the history; this just makes it say something about them.
  if (!text && steps.length) {
    try {
      const final = await callModel(
        [
          ...history,
          {
            role: "system",
            content:
              "Stop calling tools. Answer the learner now, in two or three sentences, using only what you already have above.",
          },
        ],
        { env, tools: [], model },
      );
      onStep?.({ index: maxSteps, usage: final.usage, toolCalls: [] });
      text = final.text || "";
      if (text) stoppedBy = "answered_after_cap";
    } catch {
      // Leave text empty. The cards are still a complete answer on their own.
    }
  }

  return { text, steps, stoppedBy, toolCallCount };
}

export const CAPS = { maxSteps: 4, maxToolCalls: 6 };
