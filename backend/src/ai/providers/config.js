// Provider defaults, overridable per deployment via env vars.
//
// AI_BASE_URL applies to the HTTP providers only (the Cloudflare binding has
// no URL). AI_MODEL applies to all of them.

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

export function resolveProvider(providerName, env, modelOverride = null) {
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
    // Per-call override wins, then the deployment-wide env var, then the
    // provider default. Lets a cheap model grade while a stronger one writes.
    model: modelOverride || env.AI_MODEL || base.model,
  };
}
