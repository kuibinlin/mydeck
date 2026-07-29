// Agent tool registry.
//
// A tool is { name, description, inputSchema, execute(env, ctx, args) }.
// Nothing here contains business rules — every execute() delegates to a
// service, so an agent and an HTTP route enforce identical limits, ownership
// and validation.
//
// `ctx` carries the caller identity: { user }, and optionally `resolved` — the
// words already looked up this turn, so a tool can save the characters the
// learner typed instead of the model's copy of them. Tools that write require
// the user. Never build ctx from model output — it comes from the
// authenticated session.
//
// The toOpenAI / toAnthropic adapters exist so this registry can be handed to
// whichever agent runtime is chosen later (Cloudflare Agents, LangGraph.js, or
// a hand-rolled loop) without touching the tool definitions themselves.

import * as flashcardTools from "./defs/flashcards.js";
import * as challengeTools from "./defs/challenges.js";
import * as hskTools from "./defs/hsk.js";
import * as activityTools from "./defs/activities.js";
import * as deckSaveTools from "./defs/deckSave.js";
import { repairArgs } from "./repair.js";

const TOOLS = [
  ...Object.values(flashcardTools),
  ...Object.values(challengeTools),
  ...Object.values(hskTools),
  ...Object.values(activityTools),
  ...Object.values(deckSaveTools),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export const all = () => TOOLS;

export const get = (name) => BY_NAME.get(name) ?? null;

export const names = () => TOOLS.map((t) => t.name);

// Runs a tool and always resolves — never throws.
//
// An agent loop needs failures as *data*: "deck is full, pick another" is
// something a model can recover from, whereas a thrown exception ends the run.
// Unexpected errors are logged and reported generically rather than leaking
// internals back into the prompt.
export async function execute(name, env, ctx, args = {}) {
  const tool = get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  // Models get argument types wrong on essentially every call — strings for
  // integers, a JSON string where an array belongs. Coercing here means the
  // fix applies to any caller, and a rising repair rate is visible rather than
  // absorbed. See tools/repair.js for the measurements.
  const { args: fixed, repaired } = repairArgs(tool.inputSchema, args);
  if (repaired.length) console.log(`[tool:${name}] repaired args: ${repaired.join(", ")}`);

  try {
    const result = await tool.execute(env, ctx, fixed);
    return { ok: true, result };
  } catch (err) {
    if (err?.status) {
      return { ok: false, error: err.message, status: err.status };
    }
    console.error(`[tool:${name}] unexpected failure:`, err);
    return { ok: false, error: "Tool failed unexpectedly" };
  }
}

// Hand an agent only the tools its task needs.
//
// Routing accuracy falls off sharply as the surface grows, and the tutor's
// allowlist is also where `publish_flashcard_deck` is kept away from a loop —
// creating a draft is recoverable, publishing to everyone is not.
export const select = (names) => TOOLS.filter((t) => names.includes(t.name));

export const toOpenAI = (tools = TOOLS) =>
  tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));

export const toAnthropic = (tools = TOOLS) =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
