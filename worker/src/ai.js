// worker/src/ai.js
// AI helper module — provider routing, validation, rate limiting.

// === Provider Configuration ===
// Defaults — overridden by env vars AI_BASE_URL / AI_MODEL when set.
const PROVIDERS = {
  cloudflare: { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
  },
};

// Resolve provider config: env vars override built-in defaults.
// AI_BASE_URL applies to openai, groq, and anthropic (appends correct path per provider).
// AI_MODEL applies to ALL providers.
function resolveProvider(providerName, env) {
  const base = PROVIDERS[providerName] || PROVIDERS.cloudflare;
  let url = base.url;
  if (env.AI_BASE_URL && providerName !== "cloudflare") {
    url =
      providerName === "anthropic"
        ? `${env.AI_BASE_URL}/v1/messages`
        : `${env.AI_BASE_URL}/v1/chat/completions`;
  }
  return {
    ...base,
    url,
    model: env.AI_MODEL || base.model,
  };
}

// === Validation ===

export function validateFlashcards(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.every(
    (c) =>
      typeof c.front === "string" &&
      c.front.length > 0 &&
      typeof c.meaning === "string" &&
      c.meaning.length > 0 &&
      (c.note === undefined || c.note === null || typeof c.note === "string"),
  );
}

export function validateChallengeCards(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.every(
    (c) =>
      typeof c.question === "string" &&
      c.question.length > 0 &&
      Array.isArray(c.choices) &&
      c.choices.length === 4 &&
      c.choices.every((ch) => typeof ch === "string" && ch.length > 0) &&
      typeof c.answer === "number" &&
      c.answer >= 0 &&
      c.answer <= 3,
  );
}

// === Rate Limiting ===

export async function checkRateLimit(user, env) {
  // ai_usage_log.user_id is TEXT — cast to string so SQLite type comparison works correctly
  const userId = String(user.id);

  const usageQuery = () =>
    env.DB.prepare(
      "SELECT COUNT(*) as count FROM ai_usage_log WHERE user_id = ? AND created_at >= date('now')",
    )
      .bind(userId)
      .first();

  // Admins bypass rate limits entirely so they can test and manage content freely
  if (env.ADMIN_EMAILS) {
    const adminEmails = env.ADMIN_EMAILS.split(",").map((e) => e.trim());
    if (adminEmails.includes(user.email)) {
      const row = await usageQuery();
      return { limited: false, used: row.count, limit: null };
    }
  }

  const plan = "free"; // Look up user's plan tier when paid plans are added
  const raw = plan === "pro" ? env.AI_DAILY_LIMIT_PRO : env.AI_DAILY_LIMIT_FREE;

  // Empty or unset means no limit
  if (!raw || raw.trim() === "") {
    const row = await usageQuery();
    return { limited: false, used: row.count, limit: null };
  }

  const limit = parseInt(raw, 10);
  const row = await usageQuery();
  const used = row.count;
  return { limited: used >= limit, used, limit };
}

export async function logUsage(user, endpoint, env) {
  await env.DB.prepare(
    "INSERT INTO ai_usage_log (user_id, endpoint, plan) VALUES (?, ?, ?)",
  )
    .bind(String(user.id), endpoint, "free")
    .run();
}

// === JSON Extraction ===
// LLMs sometimes wrap JSON in markdown code blocks or add extra text.

function extractJSON(raw) {
  if (!raw || typeof raw !== "string") {
    console.log("[extractJSON] raw is not a string:", typeof raw, raw);
    return null;
  }

  // Strip common preamble like "Here are the flashcards:\n" before the JSON
  let text = raw.trim();

  // Try direct parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    // Some models wrap in { "cards": [...] } or { "questions": [...] }
    if (parsed && typeof parsed === "object") {
      const vals = Object.values(parsed);
      const arr = vals.find((v) => Array.isArray(v));
      if (arr) return arr;
    }
  } catch {
    /* not valid JSON, try next strategy */
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* not valid JSON in code block */
    }
  }

  // Try finding array in raw text (greedy — finds the largest [...])
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      /* not valid JSON array */
    }
    // Try fixing common issues: trailing commas, single quotes
    try {
      const fixed = arrayMatch[0]
        .replace(/,\s*(\]|\})/g, "$1") // trailing commas
        .replace(/'/g, '"'); // single quotes
      return JSON.parse(fixed);
    } catch {
      /* still not valid */
    }
  }

  console.log(
    "[extractJSON] all strategies failed for:",
    text.substring(0, 500),
  );
  return null;
}

// === Provider Callers ===

async function callCloudflare(messages, env) {
  const config = resolveProvider("cloudflare", env);
  console.log("[CF] calling model:", config.model);
  const result = await env.AI.run(config.model, {
    messages,
    max_tokens: 8192,
  });
  console.log(
    "[CF] raw result type:",
    typeof result,
    "keys:",
    result ? Object.keys(result) : "null",
  );
  console.log("[CF] raw result:", JSON.stringify(result)?.substring(0, 1000));

  // Workers AI returns different formats depending on the model:
  // 1. { response: "..." } — most text models (Llama, Mistral, etc.)
  // 2. { response: [...] } — some models return parsed arrays directly
  // 3. { choices: [{ message: { content: "..." } }] } — OpenAI-compat models (Nemotron, etc.)
  if (typeof result === "string") return result;
  if (Array.isArray(result?.response)) return result.response;
  if (typeof result?.response === "string") return result.response;
  if (result?.choices?.[0]?.message?.content)
    return result.choices[0].message.content;
  if (result?.result?.response) return result.result.response;

  // Last resort — stringify and let extractJSON find the array
  return JSON.stringify(result);
}

async function callOpenAICompat(messages, provider, apiKey, env) {
  const config = resolveProvider(provider, env);
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`${provider} API error:`, err);
    throw new Error(`${provider} API error (status ${res.status})`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callAnthropic(messages, apiKey, env) {
  const config = resolveProvider("anthropic", env);
  const systemMsg = messages.find((m) => m.role === "system");
  const otherMsgs = messages.filter((m) => m.role !== "system");

  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: systemMsg?.content || "",
      messages: otherMsgs,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Anthropic API error:", err);
    throw new Error(`Anthropic API error (status ${res.status})`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// === Main AI Caller ===
// Provider and API key are controlled by wrangler.toml env vars only.
// AI_DEFAULT_PROVIDER: cloudflare | openai | groq | anthropic (default: cloudflare)
// AI_API_KEY: required when provider is not cloudflare
// Retries up to 3 times on invalid output, then throws 502.

export async function callAI(messages, validateFn, env) {
  const provider = env.AI_DEFAULT_PROVIDER || "cloudflare";
  const apiKey = env.AI_API_KEY || null;

  const maxRetries = parseInt(env.AI_MAX_RETRIES, 10) || 3;

  // For cloudflare reasoning models (e.g. Qwen), prepend strict instruction
  // to suppress chain-of-thought and output JSON directly
  const cfMessages =
    provider === "cloudflare"
      ? messages.map((m) =>
          m.role === "system"
            ? {
                ...m,
                content:
                  "IMPORTANT: Do NOT explain your reasoning. Do NOT output any thinking process. Output ONLY the raw JSON array immediately.\n\n" +
                  m.content,
              }
            : m,
        )
      : messages;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let raw;
      if (provider === "cloudflare") {
        raw = await callCloudflare(cfMessages, env);
      } else if (provider === "anthropic") {
        if (!apiKey)
          throw { status: 400, message: "Anthropic API key not configured" };
        raw = await callAnthropic(messages, apiKey, env);
      } else {
        if (!apiKey)
          throw { status: 400, message: `${provider} API key not configured` };
        raw = await callOpenAICompat(messages, provider, apiKey, env);
      }

      const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw);
      console.log(
        `[AI attempt ${attempt}/${maxRetries}] raw response:`,
        rawStr?.substring(0, 500),
      );

      // If raw is already a valid array, use it directly
      const parsed = Array.isArray(raw) ? raw : extractJSON(rawStr);
      if (parsed && validateFn(parsed)) return parsed;

      console.log(
        `[AI attempt ${attempt}/${maxRetries}] validation failed. Parsed:`,
        JSON.stringify(parsed)?.substring(0, 300),
      );
      // Invalid output — retry
    } catch (err) {
      console.log(
        `[AI attempt ${attempt}/${maxRetries}] error:`,
        err.message || err,
      );
      if (err.status) throw err;
      if (attempt >= maxRetries) {
        throw {
          status: 502,
          message: `AI returned invalid output after ${maxRetries} attempts. Please try again.`,
        };
      }
    }
  }

  throw {
    status: 502,
    message: `AI returned invalid output after ${maxRetries} attempts. Please try again.`,
  };
}
