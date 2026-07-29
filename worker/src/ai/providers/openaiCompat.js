// OpenAI-shaped chat completions. Covers openai, groq, and any OpenAI-
// compatible gateway (SEA-LION, together, etc.) via AI_BASE_URL.

import { resolveProvider } from "./config.js";

const TEMPERATURE = 0.7;

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
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`${provider} API error:`, err);
    // A plain Error (no .status) so generateStructured retries it rather than
    // surfacing an upstream hiccup to the caller immediately.
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
