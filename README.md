# MyDeck

A flashcard and challenge quiz app built with React 19 + Vite + Cloudflare Workers + D1.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router 7, Tailwind CSS v4 |
| Backend | Cloudflare Workers (edge runtime) |
| Database | Cloudflare D1 (SQLite) |
| Sessions | Cloudflare KV |
| AI | Cloudflare Workers AI (default) / Groq / OpenAI / Anthropic |
| Email | Resend (magic link login) |
| Auth | Email magic link + GitHub OAuth |

---

## Why Cloudflare — and what each service does

This project runs almost entirely on the Cloudflare free tier. Because the backend is already a Cloudflare Worker, it makes sense to use the rest of the Cloudflare ecosystem — everything is in one place, one dashboard, and one billing account.

### Cloudflare Workers (backend runtime)
Your API runs as a Worker — serverless JavaScript that runs at Cloudflare's edge locations worldwide. There are no servers to manage and no cold start delays.

**Free tier:** 100,000 requests/day, 10ms CPU time per request.

### Cloudflare D1 (database)
D1 is a SQLite database that lives inside Cloudflare. Your Worker reads and writes it directly without any network round trip. It stores users, decks, flashcards, challenge questions, scores, and AI usage logs.

**Free tier:** 5 million row reads/day, 100,000 row writes/day — more than enough for a personal or small team app.

### Cloudflare KV (key-value store)
KV stores user sessions and magic link tokens. It is a simple key → value store with TTL support (tokens auto-expire). Sessions are stored here so the Worker can look up "who is this cookie?" without a database query.

**Free tier:** 100,000 reads/day, 1,000 writes/day.

### Cloudflare Workers AI
Workers AI gives your Worker access to large language models without any external API key or billing setup. The AI binding (`env.AI`) runs inference directly inside Cloudflare's infrastructure. This is the **default AI provider** in this project.

**Free tier:** Included with the Workers free plan. No separate billing.

> **Note on Cloudflare Workers AI limits:** The free Workers plan has a **30-second wall clock limit** per request. LLM inference on Workers AI can take several seconds for larger outputs. If you hit this limit in production, switch to **Groq** (free tier, much faster) by setting `AI_DEFAULT_PROVIDER = "groq"` in `wrangler.toml` and providing an `AI_API_KEY` secret. See the environment variables section for details.

### Cloudflare Pages (optional — frontend hosting)
The built frontend (`dist/`) can be deployed to Cloudflare Pages. This is optional — any static host works (Netlify, Vercel, GitHub Pages, etc.).

**Free tier:** Unlimited bandwidth, 500 builds/month.

---

## Prerequisites

- Node.js v24 (see `.nvmrc` — run `nvm use` if you use nvm)
- **A [Cloudflare account](https://dash.cloudflare.com/sign-up) — free, no credit card required**
- A [Resend account](https://resend.com) for sending magic link emails (free tier: 3,000 emails/month)
- A GitHub OAuth app for GitHub login (free, takes 2 minutes to create)

---

## 1. Cloudflare account setup

Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). The free plan covers everything this project needs.

Then log in with Wrangler (the Cloudflare CLI):

```bash
cd worker
npx wrangler login
```

This opens a browser window — authorize Wrangler to access your Cloudflare account.

---

## 2. Create Cloudflare resources

The examples below use `mydeck-db` and `mydeck-sessions` as names. You can choose any names — just make sure they match in `worker/wrangler.toml` everywhere.

### Create a D1 database

```bash
cd worker
npx wrangler d1 create mydeck-db
```

Copy the `database_id` from the output and update `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mydeck-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

Also update the database name in `worker/package.json` scripts to match:

```json
"db:init": "wrangler d1 execute mydeck-db --file=schema.sql --remote",
"db:init:local": "wrangler d1 execute mydeck-db --local --file=schema.sql"
```

### Create a KV namespace

```bash
npx wrangler kv namespace create mydeck-sessions
```

Copy the `id` from the output and update `worker/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SESSIONS"
id = "YOUR_KV_NAMESPACE_ID_HERE"
```

### Initialize the database schema

```bash
cd worker
npx wrangler d1 execute mydeck-db --file=schema.sql --remote
```

---

## 3. GitHub OAuth setup

You need **two** OAuth apps — one for production, one for local dev (different callback URLs).

### Create the production OAuth app

1. Go to [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name:** MyDeck (or anything you like)
   - **Homepage URL:** your frontend URL (e.g. `https://yourdomain.com`)
   - **Authorization callback URL:** `https://your-worker.workers.dev/auth/github/callback`
     > Replace `your-worker` with your worker name. You can find it in `worker/wrangler.toml` under `name = "..."`. The full URL is `https://<name>.<your-cloudflare-subdomain>.workers.dev/auth/github/callback`. You can check the exact URL after deploying the worker with `npx wrangler deploy`.
4. Click **Register application**
5. On the next page, click **Generate a new client secret**
6. Save both the **Client ID** and **Client Secret** — you will need them in step 5

### Create the local dev OAuth app

1. Create another OAuth App (same steps)
2. Set **Authorization callback URL** to: `http://localhost:8787/auth/github/callback`
3. Save the **Client ID** and **Client Secret** — used in `worker/.dev.vars` for local dev

---

## 4. Resend setup (magic link emails)

1. Sign up at [resend.com](https://resend.com)
2. Go to **API Keys** → **Create API Key**
3. Optionally verify your sending domain (or use `onboarding@resend.dev` for testing)
4. Update `FROM_EMAIL` in `worker/wrangler.toml` to match your verified domain:
   ```toml
   FROM_EMAIL = "noreply@yourdomain.com"
   ```

---

## 5. Clone and install

```bash
git clone <repo-url>
cd mydeck

# Install frontend dependencies
npm install

# Install worker dependencies
cd worker && npm install
```

---

## 6. Configure the worker

### Update wrangler.toml

Edit `worker/wrangler.toml`. At minimum, update:

1. The `database_id` and KV `id` from step 2
2. `FRONTEND_URL` to your frontend's production URL
3. `FROM_EMAIL` to your verified sending address

```toml
[vars]
FRONTEND_URL = "https://yourdomain.com"
FROM_EMAIL = "noreply@yourdomain.com"
ADMIN_EMAILS = ""             # comma-separated admin emails, e.g. "you@example.com"
AI_DEFAULT_PROVIDER = "cloudflare"   # cloudflare | groq | openai | anthropic
AI_MAX_RETRIES = "3"
AI_DAILY_LIMIT_FREE = "100"   # max AI generations per user per day (empty = unlimited)
```

### Set production secrets

Run each command once — secrets are stored encrypted in Cloudflare and never leave it:

```bash
cd worker

npx wrangler secret put RESEND_API_KEY
# enter your Resend API key

npx wrangler secret put GITHUB_CLIENT_ID
# enter your production GitHub OAuth Client ID

npx wrangler secret put GITHUB_CLIENT_SECRET
# enter your production GitHub OAuth Client Secret

# Only needed if using Groq, OpenAI, or Anthropic as AI provider:
npx wrangler secret put AI_API_KEY
# enter your external AI provider API key
```

---

## 7. Frontend environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env`:

```
VITE_API_URL=https://your-worker.workers.dev
```

---

## 8. Local development

### Configure local secrets

Create `worker/.dev.vars` (gitignored — never commit this).
Values here override matching `[vars]` entries in `wrangler.toml` during local dev only.

```
RESEND_API_KEY=your_resend_api_key
GITHUB_CLIENT_ID=your_LOCAL_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_LOCAL_github_oauth_client_secret
FRONTEND_URL=http://localhost:5173
```

> If using an external AI provider locally, also add `AI_API_KEY=your_key`.
> For Cloudflare Workers AI, no key is needed — it uses the `env.AI` binding automatically.

### Configure local frontend URL

Create `.env.local` in the project root (gitignored):

```
VITE_API_URL=http://localhost:8787
```

### Initialize the local database

```bash
cd worker
npx wrangler d1 execute mydeck-db --local --file=schema.sql
```

### Run both servers

Open two terminals:

**Terminal 1 — Worker (API):**
```bash
cd worker && npm run dev
```
Runs on `http://localhost:8787`

**Terminal 2 — Frontend:**
```bash
npm run dev
```
Runs on `http://localhost:5173`

Open `http://localhost:5173` in your browser.

---

## 9. Deploy to production

### Deploy the worker

```bash
cd worker && npm run deploy
```

After deploying, note the worker URL shown in the output (e.g. `https://mydeck-api.yourname.workers.dev`). Use this as the `VITE_API_URL` in your frontend `.env`, and as the callback base URL in your GitHub OAuth app.

### Deploy the frontend

```bash
npm run build
```

Deploy `dist/` to Cloudflare Pages or any static host:

```bash
# Cloudflare Pages (from project root):
npx wrangler pages deploy dist/
```

---

## Commands reference

### Frontend (project root)

```bash
npm run dev       # Start dev server (Vite HMR) on localhost:5173
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
npm run lint      # Run ESLint
```

### Worker (worker/)

```bash
npm run dev            # Start local worker on localhost:8787
npm run deploy         # Deploy worker to Cloudflare
npm run db:init        # Apply schema.sql to remote D1
npm run db:init:local  # Apply schema.sql to local D1
```

---

## Environment variables reference

### Frontend (.env / .env.local)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Worker base URL (`http://localhost:8787` for local, your worker URL for prod) |

### Worker — wrangler.toml `[vars]` (safe to commit)

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_URL` | _(your URL)_ | Frontend base URL — used for OAuth redirects and magic link emails |
| `FROM_EMAIL` | _(your email)_ | Sender address for magic link emails |
| `ADMIN_EMAILS` | `""` | Comma-separated list of admin emails. Admins can edit/delete any deck. |
| `AI_DEFAULT_PROVIDER` | `cloudflare` | AI provider: `cloudflare`, `groq`, `openai`, `anthropic` |
| `AI_MODEL` | _(provider default)_ | Model name override — leave empty to use the provider's default model |
| `AI_BASE_URL` | _(provider default)_ | Base URL override for OpenAI-compatible providers — leave empty for defaults |
| `AI_MAX_RETRIES` | `3` | How many times to retry if AI returns invalid output |
| `AI_DAILY_LIMIT_FREE` | `100` | Max AI generations per user per day (empty = unlimited) |

> **Cloudflare Workers AI is the default.** No API key is needed — inference runs inside Cloudflare using the `env.AI` Workers AI binding. If you hit the 30-second request timeout on large outputs, switch to `groq` (free, fast) by changing `AI_DEFAULT_PROVIDER` and adding `AI_API_KEY` as a secret.

### Worker — secrets (set via `wrangler secret put`, never committed)

| Secret | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes | Resend API key for sending magic link emails |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth app Client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth app Client Secret |
| `AI_API_KEY` | Only for non-Cloudflare providers | API key for Groq, OpenAI, or Anthropic |

---

## Project structure

<details>
<summary>Click to expand full file tree</summary>

```
mydeck/
│
├── index.html                        ← Vite entry point
├── vite.config.js                    ← path alias @/ → src/, Tailwind plugin
├── package.json                      ← frontend dependencies and scripts
├── .nvmrc                            ← locks Node version to v24
├── .env                              ← your secrets (never commit)
├── .env.local                        ← local dev URL override (never commit)
├── .env.example                      ← template showing required variables
│
├── worker/                           ← Cloudflare Worker (API backend)
│   ├── src/
│   │   ├── index.js                  ← all route handlers, auth, CORS, admin logic
│   │   └── ai.js                     ← AI provider routing, rate limiting, validation
│   ├── schema.sql                    ← D1 database schema (all CREATE TABLE statements)
│   ├── wrangler.toml                 ← Worker config: name, D1, KV, AI binding, vars
│   ├── .dev.vars                     ← local secrets override (never commit)
│   └── package.json                  ← worker dependencies and wrangler scripts
│
└── src/
    ├── main.jsx                      ← React entry point
    ├── App.jsx                       ← all routes defined here
    ├── index.css                     ← Tailwind CSS v4 config + design tokens
    │
    ├── context/
    │   ├── AuthContext.jsx           ← session cookie, user state, isAdmin flag
    │   └── ThemeContext.jsx          ← dark/light mode (localStorage)
    │
    ├── lib/
    │   ├── apiClient.js              ← base fetch wrapper (reads VITE_API_URL)
    │   ├── aiApi.js                  ← AI endpoint wrappers
    │   ├── cn.js                     ← conditional Tailwind class utility
    │   ├── utils.js                  ← parseCSV, downloadCSV, escapeHtml, shuffle
    │   └── constants.js              ← CATEGORIES, MAX_CARDS_PER_DECK (50)
    │
    ├── components/
    │   ├── ui/                       ← Alert, Button, Card, Badge, Spinner, Modal,
    │   │                                Input, Select, Textarea, ProgressBar,
    │   │                                Tabs, EmptyState, BackButton
    │   └── layout/                   ← Header, PublicHeader, PublicLayout,
    │                                    Footer, ProtectedRoute
    │
    └── features/
        ├── auth/                     ← AuthPage, LoginForm, authApi.js
        ├── dashboard/                ← Dashboard, HeroCard, dashboardApi.js
        ├── flashcards/               ← FlashcardList, FlashcardStudy, FlashcardEdit,
        │                                CsvImport, flashcardApi.js
        ├── challenges/               ← ChallengeList, ChallengePlay, ChallengeEdit,
        │                                CsvImport, challengeApi.js
        ├── leaderboard/              ← LeaderboardOverview, Leaderboard, leaderboardApi.js
        ├── settings/                 ← SettingsPage (daily AI usage)
        ├── landing/                  ← LandingPage, sections/, landingContent.js
        └── legal/                    ← PrivacyPolicy, TermsOfService
```

</details>
