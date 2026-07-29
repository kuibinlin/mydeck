// Anthropic Messages API — not OpenAI-compatible: different auth header,
// system prompt hoisted out of messages, and a content block array in the
// response rather than a single string.

import { resolveProvider } from "./config.js";

const MAX_TOKENS = 4096;
const TEMPERATURE = 0.7;
const API_VERSION = "2023-06-01";

export async function call({ messages, apiKey, model, tools, env }) {
  const config = resolveProvider("anthropic", env, model);
  const systemMsg = messages.find((m) => m.role === "system");
  const otherMsgs = messages.filter((m) => m.role !== "system");

  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: MAX_TOKENS,
      system: systemMsg?.content || "",
      messages: otherMsgs,
      temperature: TEMPERATURE,
      ...(tools?.length ? { tools } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Anthropic API error:", err);
    // A plain Error (no .status) so generateStructured retries it rather than
    // surfacing an upstream hiccup to the caller immediately.
    throw new Error(`Anthropic API error (status ${res.status})`);
  }

  const data = await res.json();
  const blocks = Array.isArray(data.content) ? data.content : [];

  return {
    text: blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(""),
    toolCalls: blocks
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} })),
    stopReason: data.stop_reason ?? null,
    usage: data.usage
      ? {
          inputTokens: data.usage.input_tokens ?? null,
          outputTokens: data.usage.output_tokens ?? null,
        }
      : null,
    raw: data,
  };
}
