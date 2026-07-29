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
// This is the single turn an agent loop steps over: call, inspect toolCalls,
// run them, append results, call again. Structured one-shot generation is
// built on top of it in generateStructured.js.

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
