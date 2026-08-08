# Reference

## Commands

Everything runs from the **repo root**. The root `package.json` is a workspace
manifest — its scripts delegate to `frontend/` or `backend/` with `npm
--workspace`, so there is no need to `cd` into either.

```bash
npm install            # install BOTH workspaces (one lockfile at the root)

npm run dev            # start both: Worker (:8787) + frontend (:5173)
npm run dev:web        # frontend only, Vite HMR
npm run dev:api        # Worker only, wrangler dev

npm run build          # production build → frontend/dist/
npm run preview        # preview the production build locally
npm run lint           # ESLint across both workspaces

npm run test           # both suites, in sequence
npm run test:web       # frontend tests (plain Node)
npm run test:api       # backend tests (inside workerd, real local D1 + KV)

npm run check          # lint + both suites + build — the full gate, and what
                       # CI should run. Do not open a PR without it passing.

npm run deploy:api     # deploy the Worker to Cloudflare
npm run db:migrate     # apply D1 migrations to production
npm run db:migrate:local
```

Anything not surfaced at the root still works from inside the workspace:

```bash
cd backend
npm run db:init            # apply schema.sql to remote D1 (fresh DB only)
npm run db:init:local      # apply schema.sql to local D1
npm run db:migrate:list    # list migrations applied remotely
npm run hsk:index          # regenerate src/services/zh/data/hsk-core.json
npm run test:watch

cd frontend
npm run test:watch
```

`npm run hsk:index` rebuilds the 424 KB offline dictionary from the MCP server.
The output is **committed, not generated at build time** — the Worker imports it
directly and will not build without it.

---

## Operational endpoints

Unauthenticated, no bindings touched, safe to poll.

| Endpoint | Returns | For |
|---|---|---|
| `GET /health` | `{"status":"ok"}` | uptime monitoring, post-deploy smoke test |
| `GET /version` | `{"version":"abc1234","environment":"production"}` | which build is live — rollback verification |

Neither is required by the Cloudflare runtime (Workers has no orchestrator
probing before it routes traffic). They exist for CI and monitoring, and they
carry over unchanged if the API ever moves to a platform that does probe.

`/health` deliberately does **not** query D1. A health check is only worth having
if it is safe to call constantly, and `backend/test/meta.test.js` pins that by
removing the `DB` binding and requiring the route to still answer. If you need
"can the worker reach D1", add a separate authenticated endpoint — the two have
opposite requirements.

Set the version at deploy time, not in `wrangler.toml`:

```bash
npx wrangler deploy --var APP_VERSION:$(git rev-parse --short HEAD)
```

Unset, `/version` reports `development` — which is what lets a smoke test tell
production from someone's laptop.

---

## Environment variables

### Frontend — `.env` / `.env.local` (repo root)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Worker base URL. `http://localhost:8787` locally, your Worker URL in production. |

Both files live at the **repo root**, not in `frontend/` —
`frontend/vite.config.js` sets `envDir` to the root. `.env.local` overrides
`.env`, which is how local dev points at the local Worker without editing the
production value. Only `.env.example` is committed.

### Backend — `wrangler.toml` `[vars]` (safe to commit)

`backend/wrangler.toml` is gitignored; `backend/wrangler.toml.example` is the
committed template. Add any new var to both.

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_URL` | _(your URL)_ | Frontend base URL — used for OAuth redirects and magic link emails |
| `FROM_EMAIL` | _(your email)_ | Sender address for magic link emails |
| `ADMIN_EMAILS` | `""` | Comma-separated admin emails. Admins can edit/delete any deck. |
| `AI_DEFAULT_PROVIDER` | `cloudflare` | `cloudflare`, `groq`, `openai`, `anthropic` |
| `AI_MODEL` | _(provider default)_ | Model for flashcard/quiz generation — wants clean JSON, fast. A reasoning model is the wrong choice here. |
| `AI_TUTOR_MODEL` | _(provider default)_ | Model for the 中文 agent loop. **Must support tool calls.** Falls back to `AI_MODEL`. |
| `AI_BASE_URL` | _(provider default)_ | Host override for OpenAI-compatible providers. Host only — the code appends `/v1/chat/completions`. |
| `AI_MAX_RETRIES` | `3` | Retries when the model returns invalid output |
| `AI_DAILY_LIMIT_FREE` | `60` | Max model calls per user per day (empty = unlimited). **Counted per model call, not per request** — one tutor turn can spend several. |
| `MAX_CARDS_PER_DECK` | `50` | Max flashcards per deck |
| `MAX_QUESTIONS_PER_DECK` | `50` | Max questions per challenge deck |

> **Cloudflare Workers AI is the default** — no API key needed, inference runs
> inside Cloudflare via the `env.AI` binding.

> **Check a new model on both jobs before trusting it.** A model that cannot do
> tool calls does not always say so — one accepted the tool list and then answered
> from memory, which reads as a working reply while every fact in it skipped the
> dictionary. `@cf/aisingapore/gemma-sea-lion-v4-27b-it` rejects tools outright
> (errors 3030/8001); `@cf/meta/llama-3.3-70b-instruct-fp8-fast` handles them.

### Backend — secrets (via `wrangler secret put`, never committed)

| Secret | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes | Resend API key for magic link emails |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth app Client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth app Client Secret |
| `AI_API_KEY` | Only for non-Cloudflare providers | API key for Groq, OpenAI, or Anthropic |
| `AGENT_SERVICE_SECRET` | Only with the agent service | Shared with Google Secret Manager — **the same value in both**, see [secrets.md](secrets.md) |

For local dev these go in `backend/.dev.vars` instead (gitignored).

Setting, verifying and rotating any of these — including the Google Secret
Manager side — is [secrets.md](secrets.md).

### Optional service binding

```toml
[[services]]
binding = "HSK"
service = "hsk-mcp"
```

The HSK dictionary Worker, bound service-to-service. Optional —
`backend/src/integrations/hskMcp.js` falls back to the public HTTPS endpoint.
Prefer the binding: that endpoint's 30 req/min limit is **per IP, and therefore
global** behind a single Worker.

---

## Files that are gitignored but required

A fresh clone will not run until these exist. Each has a committed template or a
documented source:

| File | Source | Notes |
|---|---|---|
| `.env` | `.env.example` | frontend API URL |
| `.env.local` | — | local dev override, optional |
| `backend/wrangler.toml` | `backend/wrangler.toml.example` | bindings and vars |
| `backend/.dev.vars` | [local-development.md](local-development.md) | local secrets |
