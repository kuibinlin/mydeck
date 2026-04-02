# MyDeck

A flashcard and challenge quiz app built with React 19 + Vite + Cloudflare Workers + D1.

---

## Live demo

**[mydeck.linsnotes.com](https://mydeck.linsnotes.com)**

Log in with a magic link or GitHub OAuth. Create flashcard decks, generate cards with AI, build challenge quizzes, and compare scores on the leaderboard.

---

## Tech stack

| Layer    | Technology                                        | Cost                      |
| -------- | ------------------------------------------------- | ------------------------- |
| Frontend | React 19, Vite, React Router 7, Tailwind CSS v4   | Free (open source)        |
| Hosting  | Cloudflare Pages                                  | Free tier                 |
| Backend  | Cloudflare Workers (edge runtime)                 | Free tier                 |
| Database | Cloudflare D1 (SQLite)                            | Free tier                 |
| Sessions | Cloudflare KV                                     | Free tier                 |
| AI       | Cloudflare Workers AI · Groq · OpenAI · Anthropic | Free tier                 |
| Email    | Resend (magic link login)                         | Free tier                 |
| Auth     | Email magic link + GitHub OAuth                   | Free                      |
| Domain   | linsnotes.com (subdomain: mydeck.linsnotes.com)   | Paid (domain only)        |

---

## Why Cloudflare — and what each service does

This project runs almost entirely on the Cloudflare free tier. Because the backend is already a Cloudflare Worker, it makes sense to use the rest of the Cloudflare ecosystem — everything is in one place, one dashboard.

### Cloudflare Pages (frontend hosting)

The built frontend (`dist/`) is a static site — deploy it anywhere. Cloudflare Pages is a natural fit since the backend is already on Cloudflare, but Netlify, Vercel, GitHub Pages, or any static host works just as well.

**Free tier:** Unlimited bandwidth, 500 builds/month.

### Cloudflare Workers (backend runtime)

The API runs as a Worker — serverless JavaScript that runs at Cloudflare's edge locations worldwide. There are no servers to manage and no cold start delays.

**Free tier:** 100,000 requests/day, 10ms CPU time per request.

### Cloudflare D1 (database)

D1 is a SQLite database that lives inside Cloudflare. The Worker reads and writes it directly without any network round trip. It stores users, decks, flashcards, challenge questions, scores, and AI usage logs.

**Free tier:** 5 million row reads/day, 100,000 row writes/day — more than enough for a personal or small team app.

### Cloudflare KV (key-value store)

KV stores user sessions and magic link tokens. It is a simple key → value store with TTL support (tokens auto-expire). Sessions are stored here so the Worker can look up "who is this cookie?" without a database query.

**Free tier:** 100,000 reads/day, 1,000 writes/day.

### Cloudflare Workers AI

Workers AI gives the Worker access to large language models without any external API key or billing setup. The AI binding (`env.AI`) runs inference directly inside Cloudflare's infrastructure. This is the **default AI provider** in this project.

**Default model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — override with `AI_MODEL` in `wrangler.toml`.

**Tested models:**
```
@cf/meta/llama-3.3-70b-instruct-fp8-fast   ← default
@cf/meta/llama-4-scout-17b-16e-instruct
@cf/qwen/qwq-32b
@cf/nvidia/nemotron-3-120b-a12b
```

**Free tier:** 10,000 neurons/day at no charge, included in both the free and paid Workers plans. Beyond that, you need the Workers Paid plan ($5/month) and are billed at $0.011 per 1,000 neurons. Neuron cost scales with model size and token count.

> **Note on Cloudflare Workers AI limits:** The free Workers plan has a **30-second wall clock limit** per request. AI inference itself does **not** count against the 10ms CPU time limit — the Worker is suspended while waiting for the model response. However, large models (70B+ parameters) with long outputs can take 15–30 seconds per attempt, leaving little margin before the 30-second timeout. With retries enabled (`AI_MAX_RETRIES`), a single request could exceed this limit. If you experience timeouts, either switch to a smaller/faster model (e.g. `@cf/meta/llama-3.1-8b-instruct`) via `AI_MODEL` in `wrangler.toml`, or switch to **Groq** (free tier, ~2–5s per call) by setting `AI_DEFAULT_PROVIDER = "groq"` and providing an `AI_API_KEY` secret. See the environment variables section for details.


## Prerequisites

- Node.js v24 (see `.nvmrc` — run `nvm use` if you use nvm)
- **A [Cloudflare account](https://dash.cloudflare.com/sign-up) — free, no credit card required**
- A [Resend account](https://resend.com) for sending magic link emails (free tier: 3,000 emails/month)
- A GitHub OAuth app for GitHub login (free, takes 2 minutes to create)

---

## 1. Cloudflare account setup

Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). The free plan covers everything this project needs — no credit card required.

Then log in with Wrangler (the Cloudflare CLI) so it can manage resources on your behalf:

```bash
cd worker
npx wrangler login
```

This opens a browser window asking you to authorize Wrangler. Click **Allow** — this grants Wrangler permission to create D1 databases, KV namespaces, deploy Workers, and set secrets from your terminal. After authorization, the terminal prints `Successfully logged in` and you can close the browser tab. The OAuth token is stored locally on your machine (macOS keychain / Linux `~/.config/.wrangler/config/default.toml`) — it is never uploaded anywhere. Run `npx wrangler logout` to revoke it.

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

### Deploy the worker (first deploy)

You need to deploy the worker now to get its URL — the GitHub OAuth setup in the next step requires it.

```bash
cd worker
npm run deploy
```

The output will show your worker URL, e.g.:

```
Published mydeck-api (0.5 sec)
  https://mydeck-api.yourname.workers.dev
```

Save this URL — you'll use it for:

- GitHub OAuth callback URL (step 3)
- Frontend `VITE_API_URL` (step 7)

> The worker won't fully work yet (no secrets set), but deploying now creates the URL and enables the Workers AI binding.

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
     > Replace `your-worker` with your worker URL from step 2. For example: `https://mydeck-api.yourname.workers.dev/auth/github/callback`.
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
2. Go to **API Keys** → **Create API Key** — save the key for step 6

### Without a custom domain (quickstart)

Use Resend's built-in test address — no domain verification needed:

```toml
FROM_EMAIL = "onboarding@resend.dev"
```

> **Limitation:** Without a verified domain, Resend can only send emails to **the email address you signed up with**. Magic link login will only work for your own email. This is fine for development and personal use.

### With a custom domain (production)

1. In the Resend dashboard, go to **Domains** → **Add Domain**
2. Add the DNS records Resend gives you (SPF, DKIM, etc.)
3. Wait for verification (usually a few minutes)
4. Update `FROM_EMAIL` in `worker/wrangler.toml`:
   ```toml
   FROM_EMAIL = "noreply@yourdomain.com"
   ```

With a verified domain, magic link emails can be sent to **any** email address.

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

Run each command once — secrets are stored encrypted in Cloudflare and never leave it. The worker must be deployed first (step 2) before secrets can be set:

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

This redeploys with all your secrets and config. The worker URL is the same one from step 2.

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

| Variable       | Description                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| `VITE_API_URL` | Worker base URL (`http://localhost:8787` for local, your worker URL for prod) |

### Worker — wrangler.toml `[vars]` (safe to commit)

| Variable              | Default              | Description                                                                  |
| --------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `FRONTEND_URL`        | _(your URL)_         | Frontend base URL — used for OAuth redirects and magic link emails           |
| `FROM_EMAIL`          | _(your email)_       | Sender address for magic link emails                                         |
| `ADMIN_EMAILS`        | `""`                 | Comma-separated list of admin emails. Admins can edit/delete any deck.       |
| `AI_DEFAULT_PROVIDER` | `cloudflare`         | AI provider: `cloudflare`, `groq`, `openai`, `anthropic`                     |
| `AI_MODEL`            | _(provider default)_ | Model name override — leave empty to use the provider's default model        |
| `AI_BASE_URL`         | _(provider default)_ | Base URL override for OpenAI-compatible providers — leave empty for defaults |
| `AI_MAX_RETRIES`      | `3`                  | How many times to retry if AI returns invalid output                         |
| `AI_DAILY_LIMIT_FREE` | `100`                | Max AI generations per user per day (empty = unlimited)                      |

> **Cloudflare Workers AI is the default.** No API key is needed — inference runs inside Cloudflare using the `env.AI` Workers AI binding. If you hit the 30-second request timeout on large outputs, switch to `groq` (free, fast) by changing `AI_DEFAULT_PROVIDER` and adding `AI_API_KEY` as a secret.

### Worker — secrets (set via `wrangler secret put`, never committed)

| Secret                 | Required                          | Description                                  |
| ---------------------- | --------------------------------- | -------------------------------------------- |
| `RESEND_API_KEY`       | Yes                               | Resend API key for sending magic link emails |
| `GITHUB_CLIENT_ID`     | Yes                               | GitHub OAuth app Client ID                   |
| `GITHUB_CLIENT_SECRET` | Yes                               | GitHub OAuth app Client Secret               |
| `AI_API_KEY`           | Only for non-Cloudflare providers | API key for Groq, OpenAI, or Anthropic       |

---

## Project structure

<details>
<summary>Click to expand full file tree</summary>

```
mydeck/
│
├── index.html                        ← Vite entry point
├── vite.config.js                    ← path alias @/ → src/, Tailwind plugin
├── eslint.config.js                  ← ESLint flat config
├── package.json                      ← frontend dependencies and scripts
├── package-lock.json                 ← lock exact version of every installed dependency
├── .nvmrc                            ← locks Node version to v24
├── .env                              ← your secrets (NEVER COMMIT)
├── .env.local                        ← local dev URL override (NEVER COMMIT)
├── .env.example                      ← template showing required variables
├── .gitignore                        ← ensure certain files not tracked by Git remain untracked
├── LICENSE                           ← project license
│
├── worker/                           ← Cloudflare Worker (API backend)
│   ├── src/
│   │   ├── index.js                  ← all route handlers, auth, CORS, admin logic
│   │   └── ai.js                     ← AI provider routing, rate limiting, validation
│   ├── schema.sql                    ← D1 database schema (all CREATE TABLE statements)
│   ├── wrangler.toml                 ← Worker config: name, D1, KV, AI binding, vars
│   ├── wrangler.toml.example         ← template for wrangler.toml
│   ├── .dev.vars                     ← local secrets override (never commit)
│   ├── package-lock.json             ← lock exact version of every installed dependency.
│   └── package.json                  ← worker dependencies and wrangler scripts
│
├── public/                           ← static assets (served as-is)
│   ├── _redirects                    ← SPA redirect rules (Cloudflare Pages / Netlify)
│   ├── favicon.svg                   ← browser tab icon
│   └── icons.svg                     ← shared SVG icon sprite
│
└── src/                              ← React frontend
    ├── main.jsx                      ← React entry point
    ├── App.jsx                       ← all routes defined here
    ├── index.css                     ← Tailwind CSS v4 config + design tokens
    │
    ├── assets/                       ← images and static imports
    │   ├── hero.png                  ← landing page hero image
    │   └── vite.svg                  ← Vite logo
    │
    ├── context/
    │   ├── AuthContext.jsx           ← session cookie, user state, isAdmin flag
    │   └── ThemeContext.jsx          ← dark/light mode (localStorage)
    │
    ├── lib/
    │   ├── apiClient.js              ← base fetch wrapper (reads VITE_API_URL)
    │   ├── aiApi.js                  ← AI endpoint wrappers
    │   ├── cn.js                     ← conditional Tailwind class utility
    │   ├── confetti.js               ← confetti animation (quiz results)
    │   ├── utils.js                  ← parseCSV, downloadCSV, escapeHtml, shuffle
    │   └── constants.js              ← CATEGORIES, MAX_CARDS_PER_DECK (50)
    │
    ├── components/
    │   ├── ui/                       ← reusable UI primitives
    │   │   ├── Alert.jsx             ← error/success/warning message bar
    │   │   ├── BackButton.jsx        ← navigation back arrow
    │   │   ├── Badge.jsx             ← colored label chip
    │   │   ├── Button.jsx            ← primary/outline/ghost/danger/ai variants
    │   │   ├── Card.jsx              ← surface container with shadow
    │   │   ├── EmptyState.jsx        ← placeholder for empty lists
    │   │   ├── Input.jsx             ← text input with label
    │   │   ├── MedalBadge.jsx        ← gold/silver/bronze rank badge
    │   │   ├── Modal.jsx             ← overlay dialog
    │   │   ├── PreviewModal.jsx      ← CSV/AI import preview overlay
    │   │   ├── ProgressBar.jsx       ← horizontal progress indicator
    │   │   ├── SearchInput.jsx       ← search field with icon
    │   │   ├── Select.jsx            ← dropdown select with label
    │   │   ├── Spinner.jsx           ← loading spinner
    │   │   ├── Tabs.jsx              ← tab switcher
    │   │   └── Textarea.jsx          ← multiline text input with label
    │   │
    │   └── layout/                   ← page structure components
    │       ├── Header.jsx            ← authenticated nav bar + settings gear
    │       ├── PublicHeader.jsx       ← public nav bar (landing, login)
    │       ├── PublicLayout.jsx       ← PublicHeader + Outlet + Footer
    │       ├── Footer.jsx            ← site footer
    │       └── ProtectedRoute.jsx    ← redirects to /login if unauthenticated
    │
    └── features/
        ├── auth/                     ← AuthPage, LoginForm, authApi.js
        ├── dashboard/                ← Dashboard, HeroCard, dashboardApi.js
        ├── flashcards/
        │   ├── FlashcardList.jsx     ← deck listing page
        │   ├── FlashcardStudy.jsx    ← card flip study mode
        │   ├── FlashcardEdit.jsx     ← create/edit deck + AI generate panel
        │   ├── FlashcardCard.jsx     ← single card flip component
        │   ├── FlashcardCardForm.jsx ← card edit form (front/meaning/note)
        │   ├── CsvImport.jsx         ← CSV template download + import
        │   └── flashcardApi.js       ← API calls for flashcard decks/cards
        ├── challenges/
        │   ├── ChallengeList.jsx     ← deck listing page
        │   ├── ChallengePlay.jsx     ← quiz gameplay
        │   ├── ChallengeEdit.jsx     ← create/edit deck + AI generate panel
        │   ├── QuizQuestion.jsx      ← single question display
        │   ├── QuizChoice.jsx        ← answer choice button
        │   ├── QuestionForm.jsx      ← question edit form
        │   ├── ResultsCard.jsx       ← score + confetti after quiz
        │   ├── CsvImport.jsx         ← CSV template download + import
        │   └── challengeApi.js       ← API calls for challenge decks/questions
        ├── leaderboard/
        │   ├── LeaderboardOverview.jsx ← all challenge leaderboards
        │   ├── Leaderboard.jsx       ← single challenge leaderboard
        │   ├── LeaderboardRow.jsx    ← player row with rank/medal
        │   └── leaderboardApi.js     ← API calls for scores
        ├── settings/                 ← SettingsPage (daily AI usage)
        ├── landing/
        │   ├── LandingPage.jsx       ← public homepage
        │   ├── landingContent.js     ← all copy/text content
        │   └── sections/
        │       ├── HeroSection.jsx         ← hero banner with CTA
        │       ├── FeaturesSection.jsx     ← feature cards grid
        │       ├── HowItWorksSection.jsx   ← step-by-step explainer
        │       ├── HeroMockCard.jsx        ← animated flashcard demo
        │       └── CTASection.jsx          ← bottom call-to-action
        └── legal/                          ← PrivacyPolicy, TermsOfService
        │   ├── PrivacyPolicy.jsx           ← PrivacyPolicy
        └── └── TermsOfService.jsx          ← TermsOfService
```

</details>
