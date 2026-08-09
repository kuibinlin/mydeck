# MyDeck

A flashcard and challenge quiz app built with React 19 + Vite + Cloudflare Workers + D1.

---

## Live demo

**[mydeck.linsnotes.com](https://mydeck.linsnotes.com)**

Log in with a magic link or GitHub OAuth. Create flashcard decks, generate cards
with AI, build challenge quizzes, and compare scores on the leaderboard.

---

## Repository layout

```
mydeck/
├── frontend/          React 19 + Vite SPA          → Cloudflare Pages
├── backend/           Cloudflare Worker (API)      → Cloudflare Workers
├── infrastructure/    Terraform (scaffolding only)
├── .github/           CI/CD workflows (scaffolding only)
└── docs/              setup, development, deployment, reference
```

`frontend/` and `backend/` are npm workspaces — **one `npm install` at the root
installs both**, against a single `package-lock.json`.

See [docs/structure.md](docs/structure.md) for the full tree and the layering
rules inside each package.

---

## Quick start

```bash
git clone <repo-url>
cd mydeck
npm install

cp .env.example .env                                  # frontend API URL
cp backend/wrangler.toml.example backend/wrangler.toml # bindings and vars

npm run dev        # Worker on :8787, frontend on :5173
```

That gets the code running, but login and AI need real Cloudflare, GitHub OAuth
and Resend credentials — **[docs/setup.md](docs/setup.md)** walks through all of
it in order.

```bash
npm run dev        # both servers
npm run test       # both test suites (76 frontend + 350 backend)
npm run lint       # ESLint across both workspaces
npm run build      # → frontend/dist/
npm run deploy:api # deploy the Worker
```

Full command list: [docs/reference.md](docs/reference.md).

---

## Documentation

| Doc | Read it when |
|---|---|
| [docs/setup.md](docs/setup.md) | First clone — Cloudflare, OAuth, Resend, env files |
| [docs/local-development.md](docs/local-development.md) | Running both servers, and the tests |
| [docs/deployment.md](docs/deployment.md) | Shipping, and D1 migrations |
| [docs/reference.md](docs/reference.md) | Every command, env var and secret |
| [docs/structure.md](docs/structure.md) | Where code goes, and why |

---

## Tech stack

| Layer    | Technology                                        | Cost               |
| -------- | ------------------------------------------------- | ------------------ |
| Frontend | React 19, Vite, React Router 7, Tailwind CSS v4    | Free (open source) |
| Hosting  | Cloudflare Pages                                  | Free tier          |
| Backend  | Cloudflare Workers (edge runtime)                 | Free tier          |
| Database | Cloudflare D1 (SQLite)                            | Free tier          |
| Sessions | Cloudflare KV                                     | Free tier          |
| AI       | Cloudflare Workers AI · Groq · OpenAI · Anthropic | Free tier          |
| Email    | Resend (magic link login)                         | Free tier          |
| Auth     | Email magic link + GitHub OAuth                   | Free               |
| Domain   | linsnotes.com (subdomain: mydeck.linsnotes.com)   | Paid (domain only) |

---

## Why Cloudflare — and what each service does

This project runs almost entirely on the Cloudflare free tier. Because the backend
is already a Cloudflare Worker, the rest of the ecosystem follows — everything in
one place, one dashboard.

### Cloudflare Pages (frontend hosting)

The built frontend (`frontend/dist/`) is a static site — deploy it anywhere.
Cloudflare Pages is a natural fit since the backend is already on Cloudflare, but
Netlify, Vercel, GitHub Pages, or any static host works just as well.

**Free tier:** unlimited bandwidth, 500 builds/month.

### Cloudflare Workers (backend runtime)

The API runs as a Worker — serverless JavaScript at Cloudflare's edge locations
worldwide. No servers to manage, no cold start delays.

**Free tier:** 100,000 requests/day, 10ms CPU time per request.

### Cloudflare D1 (database)

D1 is a SQLite database inside Cloudflare. The Worker reads and writes it directly
without a network round trip. It stores users, decks, flashcards, challenge
questions, scores, and AI usage logs.

**Free tier:** 5 million row reads/day, 100,000 row writes/day.

### Cloudflare KV (key-value store)

KV stores sessions and magic link tokens — a simple key → value store with TTL, so
tokens auto-expire. Sessions live here so the Worker can answer "who is this
cookie?" without a database query.

**Free tier:** 100,000 reads/day, 1,000 writes/day.

### Cloudflare Workers AI

Workers AI gives the Worker access to large language models without an external
API key or billing setup. The `env.AI` binding runs inference inside Cloudflare's
infrastructure. This is the **default AI provider**.

Two models are configured, because no single one does both jobs well:
`AI_MODEL` generates flashcards and quizzes (wants clean JSON, fast), and
`AI_TUTOR_MODEL` drives the 中文 agent loop (must support tool calls). See
[docs/reference.md](docs/reference.md#backend--wranglertoml-vars).

**Free tier:** 10,000 neurons/day at no charge, on both the free and paid Workers
plans. Beyond that, the Workers Paid plan ($5/month) bills $0.011 per 1,000
neurons. Neuron cost scales with model size and token count.

> **On the 30-second limit:** the free Workers plan caps wall clock at 30s per
> request. AI inference does **not** count against the 10ms CPU limit — the Worker
> is suspended while waiting — but a 70B model with long output can take 15–30s
> per attempt, and `AI_MAX_RETRIES` multiplies that. If you hit timeouts, switch to
> a smaller model via `AI_MODEL`, or to Groq (free, ~2–5s per call) by setting
> `AI_DEFAULT_PROVIDER = "groq"` with an `AI_API_KEY` secret.

---

## License

See [LICENSE](LICENSE).
