# Repository structure

Five top-level concerns, each with one owner:

```
mydeck/
├── frontend/          React 19 + Vite SPA          → Cloudflare Pages
├── backend/           Cloudflare Worker (API)      → Cloudflare Workers
├── services/          Python containers            → Google Cloud Run
├── infrastructure/    Terraform — GCP, Cloudflare and GitHub root modules
├── .github/           CI/CD — ci.yml (checks only); no deploy workflow yet
├── docs/              you are here
└── <root>             workspace manifest + repo-wide config
```

`frontend/` and `backend/` are **npm workspaces**. One `npm install` at the root
installs both into one `node_modules` against one `package-lock.json`.
`services/` is not a workspace and holds no JavaScript — it is Python, managed by
uv against its own lockfile, and deployed as containers rather than to
Cloudflare.

> **`services/` at the root is not `backend/src/services/`.** The first is a
> deployment unit; the second is the Worker's domain-logic layer. Unfortunate
> collision, kept because both names are right in their own context — say which
> one you mean when it is ambiguous.

---

## Root

Only things that are genuinely repo-wide live here.

```
package.json           workspace manifest: workspaces, delegating scripts,
                       allowScripts, and repo-wide lint tooling. No app deps.
package-lock.json      one lockfile, both workspaces
eslint.config.js       flat config; `eslint .` lints frontend/ and backend/
.nvmrc                 Node v24
.env.example           template for .env (frontend API URL)
.gitignore
.dockerignore          ahead of containerisation — see the file's own comments
README.md
LICENSE
CLAUDE.md              architecture notes for Claude Code (gitignored)
```

**Why `eslint.config.js` is at the root and `vite.config.js` is not.** ESLint runs
across both packages, so its config is repo-wide and its plugins are root
devDependencies. Vite only ever builds the frontend, so its config belongs to that
workspace. The test for "does this belong at the root?" is whether it describes
the repo or one package.

---

## frontend/

```
frontend/
├── index.html                  Vite entry point
├── vite.config.js              root pin, @/ alias, envDir → repo root,
│                               vitest scoped to src/
├── package.json                React, Vite, Tailwind, vitest
├── public/
│   ├── _redirects              SPA fallback (/* /index.html 200)
│   ├── favicon.svg
│   └── icons.svg
└── src/
    ├── main.jsx                bootstraps React into #root
    ├── App.jsx                 all routes
    ├── index.css               Tailwind v4 config + design tokens (no
    │                           tailwind.config.js — it is all in here)
    ├── assets/
    ├── context/                AuthContext (session cookie), ThemeContext
    ├── lib/                    apiClient, aiApi, cn, confetti, utils, constants
    ├── components/
    │   ├── ui/                 Alert, Badge, Button, Card, Input, Modal,
    │   │                       ProgressBar, Select, Spinner, Tabs, Textarea, …
    │   └── layout/             Header, PublicHeader, PublicLayout, Footer,
    │                           ProtectedRoute
    └── features/               auth, dashboard, flashcards, challenges,
                                leaderboard, landing, legal, settings, chinese
```

**Features never import from each other.** If two features need the same
component, promote it to `components/ui/`.

Each feature is self-contained — its pages, its sub-components and its `*Api.js`
live together.

---

## backend/

```
backend/
├── wrangler.toml               committed — bindings, vars, routes, flags
├── wrangler.toml.example       committed template; add new bindings here TOO
├── .dev.vars                   gitignored — local secrets
├── schema.sql                  fresh databases only
├── migrations/                 numbered, for databases that already exist
├── scripts/build-hsk-index.mjs regenerates the offline dictionary
├── vitest.config.mjs           workerd pool + outbound network interceptor
├── test/                       25 suites, real local D1 + KV
└── src/
    ├── index.js                entry: preflight, dispatch, error mapping
    ├── config.js               PROD_ORIGINS
    ├── http/                   transport only — Request/Response, CORS, cookies
    │   ├── respond.js  body.js  session.js  router.js
    │   └── routes/             auth, flashcards, challenges, scores,
    │                           deckLinks, ai, zh, meta (health/version)
    │                           + index.js (the route table)
    ├── services/               domain logic — (env, args) in, plain data out
    │   ├── errors.js access.js auth.js flashcards.js challenges.js scores.js
    │   ├── deckLinks.js aiContent.js tutor.js hsk.js activities.js deckSave.js
    │   └── zh/                 classify, resolve, localIndex, conversation,
    │                           data/hsk-core.json (424 KB, committed)
    ├── ai/                     model access — the NON-agentic path only
    │   ├── providers/          cloudflare, openaiCompat, anthropic
    │   ├── callModel.js generateStructured.js
    │   ├── extract.js schemas.js usage.js prompts/
    └── integrations/           resend, github, hskMcp, agentService
```

`ai/` has no loop and there is no `tools/`. `agentLoop.js`, `toolMessages.js` and
the whole tool registry were deleted by architecture.md §11 step 9 — the agent
that called them is `services/agent-service` now, and it *asks* rather than acts.
What is left of `ai/` serves flashcard and quiz generation, which never moved:
one model call, no tools, JSON extracted and validated.

The layering rules are the load-bearing part, and they are documented in full in
`CLAUDE.md`. In short:

- `services/` never imports from `http/` — no Request, no Response, no CORS. That
  is what lets an HTTP route and a test call the same function, and what made
  moving the agent out of process a deletion rather than a refactor.
- `http/` only adapts: parse input → call service → shape response.
- `ai/` imports nothing from `services/` except `services/errors.js`.
  `services/tutor.js` is the composition point: it calls
  `integrations/agentService.js` for the turn, then the same services an HTTP
  route would call to materialise what comes back. That is why an agent and a
  route enforce identical limits and ownership — there is one implementation of
  each, not a parallel set for tools.

---

## Deliberate duplication across the two packages

Three files exist in both `frontend/src/features/chinese/` and `backend/src/`,
and three frontend tests import the backend copy to fail the moment they diverge:

| Frontend | Backend | Why duplicated |
|---|---|---|
| `classify.js` | `services/zh/classify.js` | the browser classifies and paints before any request is made |
| `floorPlan.js` (chip `send` strings) | `services/tutor.js` (`wantsToSave`) | the worker reads chip prompts to decide what the tutor may do — chip wording is a cross-package contract, not copy |
| `history.js` | `services/zh/conversation.js` (`boundContext`) | the client must decide what context to send without asking anyone |

The backend copy is authoritative in all three cases. Moving either package means
updating the `../../../../backend/src/...` imports in those tests.

---

## services/

```
services/
└── agent-service/              FastAPI + LangChain, → Cloud Run as mydeck-agent
    ├── app/
    │   ├── main.py             /health, /version, POST /internal/agent/turn
    │   ├── schemas.py          the Worker ↔ agent contract, version 1
    │   ├── config.py           env-driven settings; the two caps
    │   ├── tracing.py          Langfuse, optional and fail-open
    │   ├── version.py          build identity, for the deploy smoke test
    │   ├── providers/          init_chat_model, plus a scripted model for tests
    │   ├── hsk/                MCP transport + hard projection
    │   └── agent/              prompt, tools, per-turn state, run
    ├── tests/                  pytest — contract, loop, guards, dictionary, safety
    ├── pyproject.toml          deps + ruff/pyright/pytest config
    ├── uv.lock                 committed; the Dockerfile builds --frozen
    ├── .python-version         3.12, matching the image
    └── Dockerfile              two-stage, non-root, reads $PORT
```

**Status: this is the tutor.** `docs/architecture.md` §11 is the sequence and
all nine steps are done. `mydeck-agent-prod` runs warm at `min_instances = 1` and
answers in 1.7–2.8s; `mydeck-agent-dev` is the target for local `wrangler dev`
and for images not yet trusted.

There is no second implementation. Step 9 deleted the Worker's agent loop along
with the three flags that chose between them, so `AGENT_SERVICE_URL` is the whole
configuration: set, this answers; unset, the tutor is skipped. **Every failure of
this hop costs the learner the tutor's prose** — a transport error, a bad status,
an unreadable body and a policy refusal all degrade now, where only a timeout
used to. The word cards are rendered from the bundled dictionary before the
tutor is called at all, and that floor is what made the deletion safe.

Still open, and now without a net: one warm turn measured 29.8s and returned
nothing (§13). `observability/`'s p95 alert watches for a sustained regression;
individual occurrences show as `[zh] tutor unavailable` in `wrangler tail`.

Three things about it that are decisions rather than details:

- **The Worker owns every write.** The agent returns *intended actions* naming
  words by index into a list the Worker supplied. It never touches D1, never
  resolves Chinese, and never decides whether a save is authorised (§6, §8.2).
- **The agent stack is LangChain**, not a hand-rolled loop and not a port of the
  Worker's. `create_agent` runs the loop, which is why the JavaScript originals
  (`ai/agentLoop.js`, `ai/toolMessages.js`, `tools/repair.js`) got no Python
  counterpart and were simply deleted. What the framework does not have — the
  allowlist at execution time, the tool budget, seed interception, save attempts
  counted before refusal — is all in `app/agent/state.py`.
- **It is not wired into `npm test`.** `npm run test:agent`, `lint:agent`,
  `typecheck:agent` and `check:agent` exist and run from the root like everything
  else, but they need `uv` installed, and the JS suites must keep working on a
  clone that has never heard of Python. Wire them together when CI does.

Run it locally with `npm run dev:agent` (port 8080), or as the container it will
actually be:

```bash
docker build -t mydeck-agent:local services/agent-service
docker run --rm -p 8080:8080 mydeck-agent:local
```

---

## infrastructure/ and .github/

Both are scaffolding with READMEs and no implementation yet — see
[infrastructure/README.md](../infrastructure/README.md) and
[.github/workflows/README.md](../.github/workflows/README.md), which record the
decisions to make before adding the first `.tf` file or workflow.
