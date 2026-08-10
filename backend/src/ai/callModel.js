// One model turn, provider-agnostic.
//
// Returns a normalized shape regardless of which provider answered:
//
//   {
//     text:       string        assistant prose (may be "" when tools were called)
//     toolCalls:  [{ id, name, input }]
//     stopReason: string | null provider's finish/stop reason
//     usage:      { inputTokens, outputTokens } | null
//     raw:        unknown       untouched provider payload
//   }
//
// `generateStructured.js` is the only caller, and it never passes `tools` — so
// the tool half of that shape is currently unreachable. It is kept rather than
// stripped, for one reason: `normalize()` in providers/cloudflare.js must handle
// a tool-carrying reply anyway. Such a reply has `content: null`, and the null
// check that drops it lands the entire API envelope in `text`, where it renders
// to a user. That was a measured bug; test/normalize.test.js pins the fix.
//
// The agent loop that did step over this turn — call, inspect toolCalls, run
// them, append results, call again — left in architecture.md §11 step 9. The
// tutor is services/agent-service now, and it brings its own provider access.
// If nothing here needs tools by the time something else does, delete the
// parameter rather than growing a second loop around it.

import { badRequest } from "../services/errors.js";
import * as cloudflare from "./providers/cloudflare.js";
import * as openaiCompat from "./providers/openaiCompat.js";
import * as anthropic from "./providers/anthropic.js";

export function activeProvider(env) {
  return env.AI_DEFAULT_PROVIDER || "cloudflare";
}

export async function callModel(messages, { env, tools = [], model = null }) {
  const provider = activeProvider(env);
  const apiKey = env.AI_API_KEY || null;

  if (provider === "cloudflare") {
    return await cloudflare.call({ messages, model, tools, env });
  }

  if (provider === "anthropic") {
    if (!apiKey) throw badRequest("Anthropic API key not configured");
    return await anthropic.call({ messages, apiKey, model, tools, env });
  }

  if (!apiKey) throw badRequest(`${provider} API key not configured`);
  return await openaiCompat.call({
    messages,
    provider,
    apiKey,
    model,
    tools,
    env,
  });
}
