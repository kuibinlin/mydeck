// Agent tool registry.
//
// A tool is { name, description, inputSchema, execute(env, ctx, args) }.
// Nothing here contains business rules — every execute() delegates to a
// service, so an agent and an HTTP route enforce identical limits, ownership
// and validation.
//
// `ctx` carries the caller identity: { user }. Tools that write require it.
// Never build ctx from model output — it comes from the authenticated session.
//
// The toOpenAI / toAnthropic adapters exist so this registry can be handed to
// whichever agent runtime is chosen later (Cloudflare Agents, LangGraph.js, or
// a hand-rolled loop) without touching the tool definitions themselves.

import * as flashcardTools from "./defs/flashcards.js";
import * as challengeTools from "./defs/challenges.js";

const TOOLS = [
  ...Object.values(flashcardTools),
  ...Object.values(challengeTools),
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

  try {
    const result = await tool.execute(env, ctx, args);
    return { ok: true, result };
  } catch (err) {
    if (err?.status) {
      return { ok: false, error: err.message, status: err.status };
    }
    console.error(`[tool:${name}] unexpected failure:`, err);
    return { ok: false, error: "Tool failed unexpectedly" };
  }
}

export const toOpenAI = () =>
  TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));

export const toAnthropic = () =>
  TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
