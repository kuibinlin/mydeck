// Cloudflare Workers AI, via the env.AI binding — no API key, no egress.

import { resolveProvider } from "./config.js";

const MAX_TOKENS = 8192;

export async function call({ messages, model, tools, env }) {
  const config = resolveProvider("cloudflare", env, model);
  console.log("[CF] calling model:", config.model);

  const result = await env.AI.run(config.model, {
    messages,
    max_tokens: MAX_TOKENS,
    ...(tools?.length ? { tools } : {}),
  });

  console.log("[CF] raw result:", JSON.stringify(result)?.substring(0, 1000));

  return normalize(result);
}

// Workers AI response shape varies by model:
//   { response: "..." }                                  most text models
//   { response: [...] }                                  some return parsed arrays
//   { choices: [{ message: { content } }] }              OpenAI-compatible models
//   { result: { response } }                             occasionally wrapped
//
// Exported for tests: this is pure shape-mapping with no binding, and the
// tool-call branch is the one place a mistake reaches the user as raw JSON.
export function normalize(result) {
  const empty = { text: "", toolCalls: [], stopReason: null, usage: null, raw: result };

  if (typeof result === "string") return { ...empty, text: result };

  const usage = result?.usage
    ? {
        inputTokens: result.usage.prompt_tokens ?? null,
        outputTokens: result.usage.completion_tokens ?? null,
      }
    : null;

  const toolCalls = readToolCalls(result);

  // A model that returned a parsed array directly: stringify so downstream
  // extraction sees consistent input.
  if (Array.isArray(result?.response))
    return { ...empty, text: JSON.stringify(result.response), usage, toolCalls };

  if (typeof result?.response === "string")
    return { ...empty, text: result.response, usage, toolCalls };

  // An OpenAI-shaped reply. On a tool call `content` is null, so this must not
  // test for a non-null content before claiming the branch — doing so drops
  // through to the raw-payload dump below, putting the entire API envelope in
  // `text` and losing finish_reason. That reaches the user as visible JSON.
  const choice = result?.choices?.[0];
  if (choice?.message)
    return {
      ...empty,
      text: choice.message.content ?? "",
      stopReason: choice.finish_reason ?? null,
      usage,
      toolCalls,
    };

  if (result?.result?.response)
    return { ...empty, text: result.result.response, usage, toolCalls };

  // Nothing recognised — hand the whole payload downstream and let JSON
  // extraction try to find something usable.
  return { ...empty, text: JSON.stringify(result), usage, toolCalls };
}

function readToolCalls(result) {
  const raw = result?.tool_calls ?? result?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw.map((tc, i) => ({
    id: tc.id ?? `tool_${i}`,
    name: tc.name ?? tc.function?.name,
    input: parseArgs(tc.arguments ?? tc.function?.arguments ?? tc.input),
  }));
}

function parseArgs(args) {
  if (args == null) return {};
  if (typeof args === "object") return args;
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}
