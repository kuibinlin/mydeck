# Local development

Assumes [setup.md](setup.md) is done.

## Configure local secrets

Create `backend/.dev.vars` (gitignored — never commit). Values here override
matching `[vars]` entries in `wrangler.toml`, in local dev only:

```
RESEND_API_KEY=your_resend_api_key
GITHUB_CLIENT_ID=your_LOCAL_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_LOCAL_github_oauth_client_secret
FRONTEND_URL=http://localhost:5173
```

Use the **local** OAuth app's credentials here (callback
`http://localhost:8787/auth/github/callback`), not the production ones.

> With an external AI provider, add `AI_API_KEY=your_key`. For Cloudflare Workers
> AI no key is needed — it uses the `env.AI` binding.

## Configure the local frontend URL

Create `.env.local` in the **repo root** (gitignored):

```
VITE_API_URL=http://localhost:8787
```

Vite loads `.env.local` over `.env`, so this points the local frontend at the
local Worker without touching your production `.env`.

## Initialize the local database

```bash
cd backend
npm run db:init:local
```

Local D1 data lives in `backend/.wrangler/` — gitignored, and safe to delete if
you want a clean database.

## Run both servers

From the repo root, one command starts both:

```bash
npm run dev
```

| | | |
|---|---|---|
| `[api]` | Worker | `http://localhost:8787` |
| `[web]` | Frontend | `http://localhost:5173` |

Open `http://localhost:5173`. Ctrl-C stops both (`concurrently -k`).

To run just one:

```bash
npm run dev:api    # Worker only
npm run dev:web    # frontend only
```

---

## Two things that will waste an afternoon

**Browse to `localhost:5173`, not `127.0.0.1:5173`.** Wrangler's dev proxy
rewrites the upstream host in outgoing headers, and an origin containing
`127.0.0.1` comes back mangled as `http://localhost:8787:5173`, which the browser
rejects. `localhost` is what `FRONTEND_URL` and the GitHub OAuth callback use
anyway.

**`--local-upstream 127.0.0.1` in the Worker's dev script is load-bearing.**
Because `wrangler.toml` declares a `[[routes]]` pattern, `wrangler dev` otherwise
makes the Worker see requests as `http://mydeckapi.linsnotes.com/...`. The CORS
check in `backend/src/index.js` keys off that hostname to decide whether it is in
dev, so it would refuse to send `Access-Control-Allow-Origin` for
`http://localhost:5173` and every API call from the local frontend would fail in
the browser. Overriding the upstream host restores the localhost hostname.

Don't "fix" it to `--local-upstream localhost` — the same header rewriting mangles
the CORS header into `http://localhost:8787:8787:5173`.

---

## Tests

Two suites that cannot share a runner:

```bash
npm run test        # both, in sequence
npm run test:web    # frontend — plain Node
npm run test:api    # backend — inside workerd, real local D1 + KV
```

The backend suite runs the Worker in `workerd` via
`@cloudflare/vitest-pool-workers`, so its tests import `cloudflare:test` and
cannot run in plain Node. `frontend/vite.config.js` scopes `test.include` to
`src/`, which is what keeps the frontend runner from picking them up and failing
with `Cannot find package 'cloudflare:test'`.

**The backend suite never touches the network**, by two independent guards:
`backend/test/wrangler.test.toml` is a separate config directory, so
`backend/.dev.vars` (your real secrets) is not loaded and no `[ai]` binding
exists; and `outboundService` in `backend/vitest.config.mjs` intercepts every
outbound fetch. `backend/test/safety.test.js` asserts both.

> **Never point the test config at `backend/wrangler.toml`** — that loads live API
> keys and the tests will hit real services.

### Cross-package parity tests

Three frontend tests import backend source directly across the workspace
boundary:

| Frontend test | Imports from backend | Pins |
|---|---|---|
| `classify.test.js` | `services/zh/classify.js` | the duplicated classifier stays identical |
| `floorPlan.test.js` | `services/tutor.js` (`wantsToSave`) | every chip's `send` string arms the intended tool |
| `history.test.js` | `services/zh/conversation.js` (`boundContext`) | the client never sends context the server discards |

These are deliberate. The duplication buys a first frame that renders before any
request is made; the tests are what keep the copies honest. They are also why
`frontend/vite.config.js` allows `server.fs` above the frontend root — if you
ever move either package, these relative imports (`../../../../backend/src/...`)
move with it.
