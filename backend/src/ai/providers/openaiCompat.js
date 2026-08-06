// OpenAI-shaped chat completions. Covers openai, groq, and any OpenAI-
// compatible gateway (SEA-LION, together, etc.) via AI_BASE_URL.

import { resolveProvider } from "./config.js";
import { tooManyRequests } from "../../services/errors.js";

const TEMPERATURE = 0.7;

// Matches the Cloudflare provider's ceiling. Sent explicitly because a reasoning
// model with no cap is unbounded on both latency and cost: Qwen-SEA-LION-v4.5
// spent 1401 completion tokens on a three-card request, nearly all of it
// thinking. The gateway default is not something to inherit silently when the
// caller is a Worker with a wall-clock budget.
const MAX_TOKENS = 8192;

export async function call({ messages, provider, apiKey, model, tools, env }) {
  const config = resolveProvider(provider, env, model);

  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`${provider} API error:`, err);

    // 429 and 402 are the two that will not improve on retry: the allowance is
    // spent or the account cannot pay for the call. Retrying them three times
    // and then reporting "AI returned invalid output" blames the user's article
    // for a billing ceiling. Given a status, generateStructured rethrows instead.
    if (res.status === 429 || res.status === 402) {
      throw tooManyRequests(
        "The AI allowance for today is used up. Lookups and your decks still work, " +
          "and generation is back tomorrow.",
      );
    }

    // Everything else is a plain Error (no .status) so generateStructured
    // retries it rather than surfacing an upstream hiccup immediately.
    throw new Error(`${provider} API error (status ${res.status})`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  return {
    // content is null (not "") when the model answered with tool calls only.
    text: choice?.message?.content ?? "",
    toolCalls: (choice?.message?.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `tool_${i}`,
      name: tc.function?.name,
      input: parseArgs(tc.function?.arguments),
    })),
    stopReason: choice?.finish_reason ?? null,
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens ?? null,
          outputTokens: data.usage.completion_tokens ?? null,
        }
      : null,
    raw: data,
  };
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
