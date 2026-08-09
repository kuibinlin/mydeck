# Setup

One-time setup for a fresh clone: Cloudflare account, the resources the Worker
binds to, GitHub OAuth, Resend, and the two env files.

Work through this in order — step 3 needs the Worker URL that step 2 produces.

**Prerequisites**

- Node.js v24 (see `.nvmrc` — run `nvm use` if you use nvm)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) — free, no credit card required
- A [Resend account](https://resend.com) for magic link emails (free tier: 3,000 emails/month)
- A GitHub OAuth app for GitHub login (free, takes 2 minutes)

---

## 1. Clone and install

```bash
git clone <repo-url>
cd mydeck
npm install
```

**One install covers both packages.** The root `package.json` declares
`workspaces: ["frontend", "backend"]`, so `npm install` at the root resolves the
frontend and the Worker together into a single `node_modules` and a single
`package-lock.json`. Do not run `npm install` inside `frontend/` or `backend/` —
that creates a nested lockfile that drifts from the root one.

> **If you see `install scripts blocked`:** `workerd` and `esbuild` need their
> postinstall to fetch platform binaries, and npm blocks install scripts unless
> they are listed in the root `package.json`'s `allowScripts`. The versions there
> are exact, so a dependency bump has to be re-approved. Run
> `npm install-scripts ls` to see what is pending.

---

## 2. Cloudflare account setup

Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
The free plan covers everything this project needs.

Then log in with Wrangler (the Cloudflare CLI) so it can manage resources on your
behalf:

```bash
cd backend
npx wrangler login
```

This opens a browser asking you to authorize Wrangler. Click **Allow** — this
grants it permission to create D1 databases and KV namespaces, deploy Workers,
and set secrets from your terminal. After authorization the terminal prints
`Successfully logged in`. The OAuth token is stored locally (macOS keychain, or
Linux `~/.config/.wrangler/config/default.toml`) and is never uploaded. Run
`npx wrangler logout` to revoke it.

---

## 3. Create Cloudflare resources

`backend/wrangler.toml` is **gitignored** — a fresh clone only has
`backend/wrangler.toml.example`. Copy it first:

```bash
cd backend
cp wrangler.toml.example wrangler.toml
```

The examples below use `mydeck-db` and `mydeck-sessions` as names. Any names work
— just make sure they match everywhere in `backend/wrangler.toml`.

### Create a D1 database

```bash
cd backend
npx wrangler d1 create mydeck-db
```

Copy the `database_id` from the output into `backend/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mydeck-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

Also update the database name in the `db:*` scripts in `backend/package.json` to
match:

```json
"db:init": "wrangler d1 execute mydeck-db --file=schema.sql",
"db:init:local": "wrangler d1 execute mydeck-db --local --file=schema.sql"
```

### Create a KV namespace

```bash
npx wrangler kv namespace create mydeck-sessions
```

Copy the `id` from the output into `backend/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SESSIONS"
id = "YOUR_KV_NAMESPACE_ID_HERE"
```

### Initialize the database schema

```bash
cd backend
npx wrangler d1 execute mydeck-db --file=schema.sql --remote
```

> **Note on `sqlite_sequence`:** after the first insert into any `AUTOINCREMENT`
> table, SQLite creates an internal `sqlite_sequence` table tracking the highest
> ID ever used, so IDs are never reused after deletes. It is **not** in
> `schema.sql` — SQLite manages it. Seeing it in a D1 viewer is expected.

`schema.sql` is for **fresh databases only**. Once a database exists, schema
changes go through numbered files in `backend/migrations/` — see
[deployment.md](deployment.md#database-migrations).

### Deploy the Worker (first deploy)

Deploy now to get the Worker's URL — GitHub OAuth in the next step needs it.

```bash
npm run deploy:api      # from the repo root
```

The output shows your Worker URL:

```
Published mydeck-api (0.5 sec)
  https://mydeck-api.yourname.workers.dev
```

Save it — you need it for the GitHub OAuth callback (step 4) and for
`VITE_API_URL` (step 6), unless you set up a custom domain below.

> The Worker won't fully work yet (no secrets set), but deploying creates the URL
> and enables the Workers AI binding.

### Custom domain (recommended for production)

Assign a subdomain like `mydeckapi.yourdomain.com` to the Worker so the API and
frontend share the same eTLD+1. This is what lets the session cookie use
`SameSite=Lax` — iOS Safari's ITP blocks cookies from a cross-site `workers.dev`
domain, so without this, login silently fails on iPhone.

1. Cloudflare dashboard → **Workers & Pages** → your Worker → **Settings** →
   **Domains & Routes** → **Add** → **Custom Domain**
2. Enter `mydeckapi.yourdomain.com` (your domain must be on Cloudflare)
3. Use this domain as `VITE_API_URL` and as the GitHub OAuth callback host,
   instead of the `workers.dev` URL

---

## 4. GitHub OAuth setup

You need **two** OAuth apps — production and local dev have different callback
URLs, and an app accepts only one.

### Production app

1. [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. **New OAuth App**
3. Fill in:
   - **Application name:** MyDeck (or anything)
   - **Homepage URL:** your frontend URL (e.g. `https://yourdomain.com`)
   - **Authorization callback URL:** `https://mydeckapi.yourdomain.com/auth/github/callback`
     > Use your custom domain if configured. Otherwise:
     > `https://mydeck-api.yourname.workers.dev/auth/github/callback`
4. **Register application**
5. **Generate a new client secret**
6. Save the **Client ID** and **Client Secret** — needed in step 5

### Local dev app

1. Create a second OAuth App the same way
2. Set the callback URL to `http://localhost:8787/auth/github/callback`
3. Save its Client ID and Secret — these go in `backend/.dev.vars`, see
   [local-development.md](local-development.md)

---

## 5. Resend setup (magic link emails)

1. Sign up at [resend.com](https://resend.com)
2. **API Keys** → **Create API Key** — save it for the secrets step below

### Without a custom domain (quickstart)

Use Resend's built-in test address — no domain verification needed:

```toml
FROM_EMAIL = "onboarding@resend.dev"
```

> **Limitation:** without a verified domain, Resend only delivers to **the
> address you signed up with**. Magic link login will work for your own email
> only. Fine for development.

### With a custom domain (production)

1. Resend dashboard → **Domains** → **Add Domain**
2. Add the DNS records Resend gives you (SPF, DKIM)
3. Wait for verification (usually minutes)
4. Update `FROM_EMAIL` in `backend/wrangler.toml`:
   ```toml
   FROM_EMAIL = "noreply@yourdomain.com"
   ```

With a verified domain, magic links can go to any address.

---

## 6. Configure the backend

### Update wrangler.toml

Edit `backend/wrangler.toml`. At minimum:

1. The `database_id` and KV `id` from step 3
2. `FRONTEND_URL` — your frontend's production URL
3. `FROM_EMAIL` — your verified sending address

```toml
[vars]
FRONTEND_URL = "https://yourdomain.com"
FROM_EMAIL = "noreply@yourdomain.com"
ADMIN_EMAILS = ""                     # comma-separated, e.g. "you@example.com"
AI_DEFAULT_PROVIDER = "cloudflare"    # cloudflare | groq | openai | anthropic
AI_MAX_RETRIES = "3"
AI_DAILY_LIMIT_FREE = "60"            # per model call, not per request
```

The full list is in [reference.md](reference.md#backend--wranglertoml-vars).

> **`wrangler.toml` is gitignored, `wrangler.toml.example` is not.** Any new
> binding or var must be added to the example too, or a fresh clone won't build.

### Set production secrets

Run each once. Secrets are stored encrypted in Cloudflare and never leave it. The
Worker must be deployed first (step 3):

```bash
cd backend

npx wrangler secret put RESEND_API_KEY
# your Resend API key

npx wrangler secret put GITHUB_CLIENT_ID
# your PRODUCTION GitHub OAuth Client ID

npx wrangler secret put GITHUB_CLIENT_SECRET
# your PRODUCTION GitHub OAuth Client Secret

# Only if AI_DEFAULT_PROVIDER is not "cloudflare":
npx wrangler secret put AI_API_KEY
```

---

## 7. Frontend environment

Create `.env` in the **repo root** (not in `frontend/`):

```bash
cp .env.example .env
```

```
VITE_API_URL=https://mydeckapi.yourdomain.com
```

> Without a custom domain, use your `workers.dev` URL instead.

**Why the repo root?** `frontend/vite.config.js` sets `envDir` to the repo root
so one env file serves the whole repo and sits next to `.env.example`. Vite's
default is to look beside the config file — if you move `.env` into `frontend/`,
it will not be read, `VITE_API_URL` becomes `undefined`, and every API call goes
to `undefined/api/...`.

---

## Next

- [local-development.md](local-development.md) — run both servers locally
- [deployment.md](deployment.md) — ship it
