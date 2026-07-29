// One-shot structured generation: ask, extract JSON, validate, retry.
//
// Note this loop is NOT an agent loop. Every attempt re-sends the *same*
// messages and hopes for better output — it discards and retries. An agent
// loop appends tool results and continues a growing conversation. They are
// deliberately separate functions built on the same callModel primitive.

import { badGateway } from "../services/errors.js";
import { callModel, activeProvider } from "./callModel.js";
import { extractJSON } from "./extract.js";

const DEFAULT_RETRIES = 3;

// Reasoning models (Qwen, QwQ) narrate their thinking before answering, which
// buries the JSON. Cloudflare hosts several, so tell them not to.
const NO_REASONING =
  "IMPORTANT: Do NOT explain your reasoning. Do NOT output any thinking process. Output ONLY the raw JSON array immediately.\n\n";

function withNoReasoningPreamble(messages) {
  return messages.map((m) =>
    m.role === "system" ? { ...m, content: NO_REASONING + m.content } : m,
  );
}

export async function generateStructured(
  messages,
  validateFn,
  env,
  { expect = "array", model = null } = {},
) {
  const maxRetries = parseInt(env.AI_MAX_RETRIES, 10) || DEFAULT_RETRIES;
  const prepared =
    activeProvider(env) === "cloudflare"
      ? withNoReasoningPreamble(messages)
      : messages;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await callModel(prepared, { env, model });

      console.log(
        `[AI attempt ${attempt}/${maxRetries}] raw response:`,
        result.text?.substring(0, 500),
      );

      const parsed = extractJSON(result.text, { expect });
      if (parsed && validateFn(parsed)) return parsed;

      console.log(
        `[AI attempt ${attempt}/${maxRetries}] validation failed. Parsed:`,
        JSON.stringify(parsed)?.substring(0, 300),
      );
      // Invalid output — fall through and retry.
    } catch (err) {
      console.log(
        `[AI attempt ${attempt}/${maxRetries}] error:`,
        err.message || err,
      );
      // Errors carrying a status are the caller's problem (bad config, missing
      // key) and will not improve on retry. Everything else is transient.
      if (err.status) throw err;
      if (attempt >= maxRetries) {
        throw badGateway(
          `AI returned invalid output after ${maxRetries} attempts. Please try again.`,
        );
      }
    }
  }

  throw badGateway(
    `AI returned invalid output after ${maxRetries} attempts. Please try again.`,
  );
}
