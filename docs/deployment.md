# Deployment

Both halves deploy independently. Neither is automated yet — see
[.github/workflows/README.md](../.github/workflows/README.md) for what a CI job
would run.

## Deploy the backend (Worker)

```bash
npm run deploy:api        # from the repo root
```

Equivalent to `cd backend && npm run deploy`. This uploads the script with all
bindings from `backend/wrangler.toml`; secrets already stored in Cloudflare are
untouched.

## Deploy the frontend

```bash
npm run build                              # → frontend/dist/
npx wrangler pages deploy frontend/dist    # from the repo root
```

`frontend/dist/` is a plain static bundle — Cloudflare Pages, Netlify, Vercel,
GitHub Pages or any static host will serve it. `frontend/public/_redirects`
(`/* /index.html 200`) is copied into the build and is what makes client-side
routing work on a hard refresh; whatever host you use needs an equivalent SPA
fallback rule.

> ### If the Pages project already exists, update its build settings
>
> The output directory moved when the repo was reorganised:
>
> | Setting | Was | Now |
> |---|---|---|
> | Build command | `npm run build` | `npm run build` (unchanged) |
> | Build output directory | `dist` | `frontend/dist` |
> | Root directory | `/` | `/` (unchanged) |
>
> The build command is unchanged because the root `package.json` delegates to the
> frontend workspace. Only the output path moved.

---

## Database migrations

`schema.sql` is for **fresh databases only** — `CREATE TABLE IF NOT EXISTS` will
not alter a table that already exists. Any schema change to a live database needs
a numbered file in `backend/migrations/`, **and** `schema.sql` updated to match so
new installs land in the same state.

```bash
npm run db:migrate:local     # apply to local D1
npm run db:migrate           # apply to production
cd backend && npm run db:migrate:list   # what's applied remotely
```

Backfills should preserve current behaviour rather than apply a new rule
retroactively. `0001_flashcard_publish.sql` publishes every existing non-empty
deck (`> 0` cards) rather than only those meeting the new 3-card threshold, so
nothing that was public before the migration silently disappears after it.

---

## Environment differences worth knowing

**The session cookie is `SameSite=Lax`.** That works only because the frontend
(`linsnotes.com`) and API (`mydeckapi.linsnotes.com`) share an eTLD+1, making them
same-site. If you deploy the API to a bare `workers.dev` URL while the frontend is
on your own domain, iOS Safari's ITP will drop the cookie and login will fail on
iPhone while working fine on desktop. Set up the custom domain — see
[setup.md](setup.md#custom-domain-recommended-for-production).

**Workers AI has a 30-second wall-clock limit on the free plan.** Inference does
not count against the 10ms CPU limit (the Worker is suspended while waiting), but
a 70B model with long output can take 15–30s per attempt, and `AI_MAX_RETRIES`
multiplies that. If you hit timeouts, either switch to a smaller model via
`AI_MODEL`, or move to Groq (`AI_DEFAULT_PROVIDER = "groq"` plus an `AI_API_KEY`
secret, ~2–5s per call).

**`AI_DAILY_LIMIT_FREE` counts model calls, not requests.** One tutor turn runs an
agent loop and can spend several. This is why the limit is 60 rather than the 3
that the single-turn generation path needed.
