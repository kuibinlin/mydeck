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
| AI | Cloudflare Workers AI / Groq / OpenAI / Anthropic |
| Email | Resend (magic link login) |
| Auth | Email magic link + GitHub OAuth |

---

## Prerequisites

- Node.js v24 (see `.nvmrc` — run `nvm use` if you use nvm)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is enough)
- A [Resend account](https://resend.com) for magic link emails
- A GitHub OAuth app for GitHub login

---

## 1. Cloudflare setup

### Create a D1 database

The examples below use `mydeck-db` and `mydeck-sessions` as names — you can use any name you like, just make sure it matches in `worker/wrangler.toml` and `worker/package.json` everywhere.

```bash
cd worker
npx wrangler d1 create mydeck-db
```

Copy the `database_id` from the output and update `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mydeck-db"   # can be any name — must match here and in package.json scripts
database_id = "YOUR_DATABASE_ID_HERE"
```

Also update `worker/package.json` scripts to match:

```json
"db:init": "wrangler d1 execute mydeck-db --file=schema.sql",
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
id = "YOUR_KV_NAMESPACE_ID_HERE"   # the name above is just a label in Cloudflare dashboard
```

### Initialize the database schema

```bash
cd worker
npx wrangler d1 execute mydeck-db --file=schema.sql --remote
```

---

## 2. External services setup

### Resend (magic link emails)

1. Sign up at [resend.com](https://resend.com)
2. Create an API key
3. Verify your sending domain (or use the Resend sandbox for testing)

### GitHub OAuth app (for GitHub login)

You need **two** OAuth apps — one for production, one for local dev.

**Production app:**
1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Set **Authorization callback URL** to: `https://your-worker.workers.dev/auth/github/callback`
3. Save the Client ID and Client Secret

**Local dev app:**
1. Create another OAuth App
2. Set **Authorization callback URL** to: `http://localhost:8787/auth/github/callback`
3. Save the Client ID and Client Secret

---

## 3. Clone and install

```bash
git clone <repo-url>
cd mydeck

# Install frontend dependencies
npm install

# Install worker dependencies
cd worker && npm install
```

---

## 4. Configure the worker

### Update wrangler.toml

Edit `worker/wrangler.toml` and set the correct `database_id` and KV `id` from step 1.

Update `[vars]` to match your setup:

```toml
[vars]
FROM_EMAIL = "noreply@yourdomain.com"
AI_DEFAULT_PROVIDER = "openai"      # cloudflare | openai | groq | anthropic
AI_BASE_URL = ""                     # leave empty for cloudflare
AI_MODEL = ""                        # leave empty to use the default model
AI_MAX_RETRIES = "3"
AI_DAILY_LIMIT_FREE = "10"
```

### Set production secrets (run once, stored encrypted in Cloudflare)

```bash
cd worker

npx wrangler secret put RESEND_API_KEY
# enter your Resend API key

npx wrangler secret put GITHUB_CLIENT_ID
# enter your production GitHub OAuth Client ID

npx wrangler secret put GITHUB_CLIENT_SECRET
# enter your production GitHub OAuth Client Secret

npx wrangler secret put FRONTEND_URL
# enter your production frontend URL, e.g. https://yourdomain.com

npx wrangler secret put AI_API_KEY
# enter your AI provider API key (leave blank if using Cloudflare Workers AI)
```

---

## 5. Frontend environment

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env`:

```
VITE_API_URL=https://your-worker.workers.dev
```

---

## 6. Local development

### Configure local secrets

Create `worker/.dev.vars` (gitignored — never commit this):

```
# Values here override matching [vars] entries in wrangler.toml during local dev

RESEND_API_KEY=your_resend_api_key
GITHUB_CLIENT_ID=your_local_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_local_github_oauth_client_secret
FRONTEND_URL=http://localhost:5173
AI_API_KEY=your_ai_provider_api_key
```

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

## 7. Deploy to production

### Deploy the worker

```bash
cd worker && npm run deploy
```

### Deploy the frontend

Build the frontend and deploy `dist/` to Cloudflare Pages (or any static host):

```bash
npm run build
```

Then deploy `dist/` via the Cloudflare dashboard or `wrangler pages deploy dist/`.

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
npm run dev          # Start local worker on localhost:8787
npm run deploy       # Deploy worker to Cloudflare
npm run db:init      # Apply schema.sql to remote D1
npm run db:init:local  # Apply schema.sql to local D1
```

---

## Environment variables reference

### Frontend (.env / .env.local)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Worker base URL (`http://localhost:8787` for local, production URL for prod) |

### Worker (wrangler.toml [vars] — safe to commit)

| Variable | Description |
|---|---|
| `FROM_EMAIL` | Sender address for magic link emails |
| `AI_DEFAULT_PROVIDER` | AI provider: `cloudflare`, `openai`, `groq`, `anthropic`. **Default is `groq`** — see note below. |
| `AI_BASE_URL` | Base URL for OpenAI-compatible providers (empty for Cloudflare) |
| `AI_MODEL` | Model name override (empty uses provider default) |
| `AI_MAX_RETRIES` | Max retries for AI generation (default: 3) |
| `AI_DAILY_LIMIT_FREE` | Max AI generations per user per day (empty = unlimited) |

> **Why Groq is the default instead of Cloudflare Workers AI**
>
> Cloudflare Workers AI runs inside the worker's execution context. While AI inference time itself is excluded from the CPU limit, the free plan has a **30-second wall clock limit** per request — and LLM calls on Workers AI can be slow enough to approach or exceed this. Groq is an external API call that is significantly faster (typically under 3 seconds), making it more reliable for production use. If you switch to `cloudflare`, be aware of this limit, especially on the free plan.

### Worker secrets (wrangler secret put — never commit)

| Secret | Description |
|---|---|
| `RESEND_API_KEY` | Resend API key for sending emails |
| `GITHUB_CLIENT_ID` | GitHub OAuth app Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app Client Secret |
| `FRONTEND_URL` | Frontend base URL (used for OAuth redirects and magic links) |
| `AI_API_KEY` | API key for the configured AI provider |

---

## Project structure

<details>
<summary>Click to expand full file tree</summary>

```
mydeck/
│
│  ← ROOT LEVEL
│     fixed names, cannot change
│     tool configuration lives here
│
├── index.html                        ← Vite entry point
│                                        never edit manually
│                                        Vite injects JS bundle here
│
├── vite.config.js                    ← Vite configuration
│                                        base URL for Cloudflare Pages
│                                        path aliases like @/
│                                        plugins (@tailwindcss/vite)
│
├── package.json                      ← project manifest
│                                        dependencies
│                                        npm scripts
│
├── package-lock.json                 ← exact versions locked
│                                        auto generated
│                                        commit to git
│                                        ensures everyone uses same versions
│
├── .nvmrc                            ← locks Node version
│                                        contains: 24
│                                        nvm use reads this automatically
│
├── .gitignore                        ← what git never tracks
│                                        node_modules/
│                                        dist/
│                                        .env
│
├── .env                              ← your real secrets
│                                        never commit
│                                        VITE_API_URL=https://your-worker.dev
│
├── .env.local                        ← local dev overrides
│                                        never commit
│                                        VITE_API_URL=http://localhost:8787
│
├── .env.example                      ← safe template
│                                        always commit
│                                        shows what variables are needed
│                                        no real values
│
├── node_modules/                     ← installed packages
│                                        auto generated
│                                        never commit
│                                        never touch manually
│
├── dist/                             ← built output
│                                        auto generated by npm run build
│                                        deployed to Cloudflare Pages
│                                        never edit manually
│
├── public/                           ← static files
│   │                                    served exactly as-is
│   │                                    not processed by Vite
│   │                                    referenced by exact URL path
│   │
│   ├── favicon.ico                   ← /favicon.ico
│   ├── robots.txt                    ← /robots.txt
│   └── og-image.png                  ← /og-image.png
│
├── worker/                           ← Cloudflare Worker API backend
│   │                                    separate project with its own package.json
│   │                                    deployed independently via wrangler deploy
│   │                                    runs on Cloudflare's edge network
│   │
│   ├── src/
│   │   ├── index.js                  ← entire API in one file
│   │   │                                CORS, auth, all route handlers
│   │   │                                reads/writes D1 database
│   │   │                                reads/writes KV sessions
│   │   │                                sets httpOnly session cookies
│   │   │
│   │   └── ai.js                     ← AI provider routing and rate limiting
│   │                                    callAI(), checkRateLimit(), logUsage()
│   │                                    provider configured via wrangler.toml
│   │
│   ├── schema.sql                    ← D1 database schema
│   │                                    all CREATE TABLE statements
│   │                                    run via wrangler d1 execute
│   │
│   ├── wrangler.toml                 ← Cloudflare Worker configuration
│   │                                    D1 database binding
│   │                                    KV namespace binding
│   │                                    environment variables
│   │
│   ├── .dev.vars                     ← local dev secrets (gitignored)
│   │                                    overrides wrangler.toml [vars] locally
│   │                                    never commit
│   │
│   └── package.json                  ← worker dependencies
│                                        wrangler dev/deploy scripts
│
└── src/
    ├── main.jsx                      ← JavaScript entry point
    ├── App.jsx                       ← routing (all routes defined here)
    ├── index.css                     ← Tailwind CSS v4 + design tokens
    │
    ├── context/
    │   ├── AuthContext.jsx           ← logged-in user state + session cookie
    │   └── ThemeContext.jsx          ← dark/light mode
    │
    ├── lib/
    │   ├── apiClient.js              ← base fetch wrapper (reads VITE_API_URL)
    │   ├── aiApi.js                  ← AI endpoint calls
    │   ├── cn.js                     ← conditional Tailwind class utility
    │   ├── utils.js                  ← parseCSV, downloadCSV, escapeHtml
    │   └── constants.js              ← CATEGORIES, MAX_CARDS_PER_DECK
    │
    ├── components/
    │   ├── ui/                       ← Button, Card, Badge, Spinner, Modal,
    │   │                                Input, Select, Textarea, Alert,
    │   │                                ProgressBar, Tabs, EmptyState,
    │   │                                BackButton, PreviewModal
    │   └── layout/                   ← Header, PublicHeader, PublicLayout,
    │                                    Footer, ProtectedRoute
    │
    └── features/
        ├── auth/                     ← AuthPage, LoginForm, authApi.js
        ├── dashboard/                ← Dashboard, HeroCard, dashboardApi.js
        ├── flashcards/               ← FlashcardList, FlashcardStudy,
        │                                FlashcardEdit, CsvImport, flashcardApi.js
        ├── challenges/               ← ChallengeList, ChallengePlay,
        │                                ChallengeEdit, CsvImport, challengeApi.js
        ├── leaderboard/              ← LeaderboardOverview, Leaderboard,
        │                                leaderboardApi.js
        ├── landing/                  ← LandingPage, landingContent.js, sections/
        ├── legal/                    ← PrivacyPolicy, TermsOfService
        └── settings/                 ← SettingsPage (daily AI usage)
```

</details>
