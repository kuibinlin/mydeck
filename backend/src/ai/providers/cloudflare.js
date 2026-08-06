// Cloudflare Workers AI, via the env.AI binding — no API key, no egress.

import { resolveProvider } from "./config.js";
import { tooManyRequests, badGateway } from "../../services/errors.js";

const MAX_TOKENS = 8192;

export async function call({ messages, model, tools, env }) {
  const config = resolveProvider("cloudflare", env, model);
  console.log("[CF] calling model:", config.model);

  let result;
  try {
    result = await env.AI.run(config.model, {
      messages,
      max_tokens: MAX_TOKENS,
      ...(tools?.length ? { tools } : {}),
    });
  } catch (err) {
    throw translate(err, config.model);
  }

  console.log("[CF] raw result:", JSON.stringify(result)?.substring(0, 1000));

  return normalize(result);
}

// The binding throws a plain Error with the code in the message and no `.status`
// — and status is exactly what the two callers upstream use to decide whether
// retrying is worth anything. Untranslated, "you have used up your daily free
// allocation of 10,000 neurons" was retried three times and then reported to the
// user as "AI returned invalid output after 3 attempts. Please try again.",
// which blames their article for an account-level ceiling and sends them to
// retry something that cannot succeed until the allocation resets.
//
// Giving these a status makes generateStructured's existing `if (err.status)
// throw err` do the right thing, so the classification lives in one place.
//
// Exported for tests: mapping an upstream string to a user-facing sentence is
// the kind of thing that rots silently when the upstream wording changes.
export function translate(err, model) {
  const text = String(err?.message ?? err);

  // 4006 — the account's Workers AI free allocation for the day.
  if (/\b4006\b/.test(text) || /daily free allocation|out of neurons/i.test(text)) {
    return tooManyRequests(
      "The AI allowance for today is used up. Lookups and your decks still work, " +
        "and generation is back tomorrow.",
    );
  }

  // A model name that does not exist never improves on retry either. Worth its
  // own message: this is a deployment mistake, not a capacity one.
  if (/no such model|model not found|invalid model|\b5007\b/i.test(text)) {
    return badGateway(`The configured AI model (${model}) is not available.`);
  }

  // Genuinely unknown — leave it status-less so the retry above still applies.
  return err instanceof Error ? err : new Error(text);
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
