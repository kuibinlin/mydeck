# AI Integration Design Discussion

> Status: Design agreed, not yet implemented.
> Last updated: 2026-04-01

---

## Features Planned

### 1. Flashcard Deck Generation

- User pastes an article + sets a card count
- AI generates that many cards in the existing `{front, meaning, note}` format
- Cards are bulk-inserted via the existing `addCard()` API — no schema changes needed

### 2. Vocab Challenge (MCQ)

Two sources:

- **From existing deck** — sends the deck's cards to AI; AI auto-detects language direction (front = target language being learned, back = known language) and generates MCQ questions in the correct direction
- **From article** — AI extracts vocabulary from the article, then generates MCQ questions

Output format matches existing challenge cards: `{question, choices: string[4], answer: 0-3}`

### 3. Comprehension Challenge (MCQ)

- Source: pasted article only
- AI generates questions about meaning, main idea, inference, etc.
- Same MCQ output format as vocab challenge

---

## Backend — New Endpoints (worker/src/index.js)

| Method | Path                             | Input                                        | Output                            |
| ------ | -------------------------------- | -------------------------------------------- | --------------------------------- |
| GET    | `/api/ai/settings`               | —                                            | `{ provider, has_key }`           |
| PUT    | `/api/ai/settings`               | `{ provider, api_key }`                      | `{ ok }`                          |
| POST   | `/api/ai/generate-flashcards`    | `{ article, count }`                         | `[{ front, meaning, note }]`      |
| POST   | `/api/ai/generate-vocab`         | `{ cards[], count }` or `{ article, count }` | `[{ question, choices, answer }]` |
| POST   | `/api/ai/generate-comprehension` | `{ article, count }`                         | `[{ question, choices, answer }]` |

All endpoints require auth (`requireUser()`). Zero changes to existing routes or bindings.

### Input Validation

Applied at the endpoint level before calling any AI:

| Parameter                 | Rule                                                   | Error                                            |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `article`                 | Max 10,000 characters                                  | 400 — "Article too long (max 10,000 characters)" |
| `count`                   | Integer, min 1, max 30                                 | 400 — "Count must be between 1 and 30"           |
| `provider` (PUT settings) | Must be one of `["cf", "openai", "groq", "anthropic"]` | 400 — "Unknown provider"                         |

### LLM Output Validation

The Worker validates the AI response before returning it to the client:

- **Flashcards**: must be an array of `{ front: string, meaning: string, note: string }`
- **Challenges**: must be an array of `{ question: string, choices: string[4], answer: 0-3 }`

If validation fails, retry up to **2 more times** (3 attempts total). If all 3 fail, return:

```json
{ "error": "AI returned invalid output after 3 attempts. Please try again." }
```

HTTP status: 502.

### Rate Limiting

Simple per-user daily limit, designed to be tier-aware when paid plans are added later.

**New D1 table:**

```sql
CREATE TABLE ai_usage_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_usage_user_date ON ai_usage_log(user_id, created_at);
```

**Current limits (free plan):** 3 generations per user per UTC day (all AI endpoints combined).

Check before every generation call:

```sql
SELECT COUNT(*) FROM ai_usage_log
WHERE user_id = ? AND created_at >= date('now')
```

If count ≥ limit → return 429:

```json
{ "error": "Daily AI generation limit reached (3/3)." }
```

**Future-proofing:** Limits are stored in a `PLAN_LIMITS` constant map:

```js
const PLAN_LIMITS = { free: 3, pro: 50 };
```

The `checkRateLimit(user, env)` function reads the user's plan tier and looks up the corresponding limit. When paid plans are added, only the user's tier and the `PLAN_LIMITS` map need updating — the rate-check logic stays the same.

---

## AI Provider Strategy

### Default: Cloudflare Workers AI

- Free, built-in, no user setup needed
- Add to `wrangler.toml`:
  ```toml
  [ai]
  binding = "AI"
  ```
- Usage in worker: `await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages })`

### User's Own Key (optional override)

User picks a provider from a dropdown and enters their API key. No endpoint URL exposed — URLs are hardcoded in the Worker per provider:

| Provider      | Endpoint (hardcoded)                              | API Format                   |
| ------------- | ------------------------------------------------- | ---------------------------- |
| CF Workers AI | `env.AI` native binding                           | OpenAI-compat                |
| OpenAI        | `https://api.openai.com/v1/chat/completions`      | OpenAI                       |
| Groq          | `https://api.groq.com/openai/v1/chat/completions` | OpenAI-compat                |
| Anthropic     | `https://api.anthropic.com/v1/messages`           | **Different — special case** |

> **Anthropic caveat:** Anthropic is NOT OpenAI-compatible. It uses different headers (`x-api-key`, `anthropic-version`) and a different request/response shape. It needs a separate code path in the `callAI()` helper — roughly 20 extra lines.

### callAI() helper (design)

Lives in `worker/src/ai.js` (separate module to keep `index.js` manageable).

```
callAI(messages, schema, user, env)
  → fetch user's AI settings from D1
  → select provider:
      if "openai" or "groq": OpenAI-compat fetch
      if "anthropic": Anthropic-native fetch
      if no custom key / "cf": env.AI.run()
  → parse response as JSON
  → validate against schema
  → if invalid: retry (up to 3 attempts total)
  → if all attempts fail: throw ValidationError
```

The `schema` parameter defines the expected output shape so the same helper handles both flashcard and challenge generation with appropriate validation.

---

## API Key Storage Design

### Decision: D1 with application-level encryption

- New D1 table: `user_ai_settings (user_id, provider, encrypted_key)`
- Key is **encrypted before storing** using **AES-GCM** via the Web Crypto API (native in Workers runtime), with a Worker Secret as the encryption key

```
openssl rand -base64 32
```

- Stored format: `iv:ciphertext` (both base64-encoded) in the `encrypted_key` column
- D1 is already encrypted at rest by Cloudflare; app-level encryption adds a second layer so a raw DB dump is useless without the Worker Secret
- Worker Secrets (`wrangler secret put`) are global-per-Worker — **not suitable for per-user keys**
- **Frontend never receives the raw key** — GET `/api/ai/settings` returns only `{ provider, has_key: true/false }`

### Why not alternatives?

- **KV session-only** (key expires with session): user must re-enter every session — poor UX
- **Worker Secrets**: global, not per-user — wrong tool
- **Frontend localStorage**: key exposed in browser — insecure

---

## Frontend Changes (all additive, non-breaking)

| File                                        | Change                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/lib/aiApi.js`                          | New file — API calls for generate endpoints + settings                                             |
| `src/features/flashcards/FlashcardEdit.jsx` | Add "Generate with AI" panel (textarea + count + button)                                           |
| `src/features/challenges/ChallengeEdit.jsx` | Add "Generate with AI" panel (mode selector: vocab from deck / vocab from article / comprehension) |
| `src/features/settings/SettingsPage.jsx`    | New `/settings` route (ProtectedRoute) — provider dropdown + API key input + usage display         |

### Frontend UX Notes

- AI generation takes 5–30s → show a spinner with "Generating…" text inside the generate panel
- Disable the generate button while loading to prevent duplicate requests
- Use `AbortController` to allow the user to cancel a generation in progress
- On error (429 rate limit, 502 validation failure), display the `error` message from the response inline

---

## Open Questions (resolved)

| Question                                     | Decision                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Where does AI key live?                      | D1, encrypted with Worker Secret (AES-GCM, `iv:ciphertext` format)                 |
| Expose endpoint URL to user?                 | No — hardcoded per provider                                                        |
| How to handle Anthropic (not OpenAI-compat)? | Special code path in callAI() helper                                               |
| Which providers?                             | CF Workers AI (default), OpenAI, Groq, Anthropic                                   |
| LLM output validation?                       | Validate schema, retry up to 2 more times (3 total), then 502 error                |
| Rate limiting?                               | D1-based `ai_usage_log` table, 3/day free plan, `PLAN_LIMITS` map for future tiers |
| AI settings UI location?                     | Dedicated `/settings` route under ProtectedRoute                                   |
| Where does callAI() live?                    | `worker/src/ai.js` — separate module                                               |
