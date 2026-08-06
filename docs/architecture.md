# Architecture — current state and proposed direction

> **Status: decided, not implemented.**
>
> [structure.md](structure.md) describes what the repository *is* today. This
> document describes where it is *going*. The direction is settled (§8); none of
> it exists yet.
>
> Last revised: 2026-08-07. Every number and import claim below was measured
> against the tree at that date; re-measure before trusting them.

---

## 1. Today

```
Browser
   ↓
Cloudflare Pages ──── React 19 + Vite (frontend/)
   ↓
Cloudflare Worker ─── the entire API (backend/)
   ├── D1        users, decks, cards, scores, ai_usage_log
   ├── KV        sessions, magic-link tokens
   ├── AI        Workers AI binding
   └── HSK       optional service binding → dictionary Worker
```

One Worker holds authentication, authorisation, all business logic, both AI
paths and every database write. It is the whole backend and the whole security
boundary.

### The two AI paths

They are already separate — this matters more than anything else in this
document, so it is stated first:

```
NON-AGENTIC   routes/ai.js → aiContent.js → generateStructured → callModel
              no tools, one model call, JSON extracted and validated
              3 endpoints: generate-flashcards, generate-vocab,
                           generate-comprehension

AGENTIC       routes/zh.js → tutor.js → runAgent → callModel ⇄ execute
              tools attached, 1–4 model calls per turn
              1 endpoint: POST /api/zh/turn
```

`services/aiContent.js` imports neither `agentLoop` nor `registry`. The
separation is real and already enforced by the module graph.

The configuration agrees: `AI_MODEL` and `AI_TUTOR_MODEL` are independent vars,
and quota accounting already differs — `aiContent` logs once per request, while
`tutor.respond` writes one `ai_usage_log` row per model step.

---

## 2. Why change anything

One reason, and it is measured rather than aesthetic.

`wrangler.toml.example` records that reasoning models in the agent loop took
**~200s per turn**. The free Workers plan caps wall clock at **30s** per request.
The agentic path is pressed against a ceiling the non-agentic path never
approaches, and no amount of tuning inside Workers removes it.

Secondary reasons, all real but none sufficient alone:

- Document ingestion (PDF parsing), retrieval and embeddings have no good story
  inside a Worker — no filesystem, no native libraries, 128MB memory.
- Python's ecosystem for agent orchestration, structured output and evaluation
  is genuinely ahead of the JS equivalent.
- Portability and learning the container/IaC toolchain.

**Scale is not a reason.** Workers already run in 300+ locations, auto-scale
with no configuration and cold-start in ~5ms. Cloud Run scales to zero but is
regional with 100ms–2s Node/Python cold starts. Moving to containers buys
control and portability, not headroom.

---

## 3. Target

```
Browser
   ↓
Cloudflare  ── DNS · TLS · WAF · rate limiting
   ├── Pages ────────── React frontend
   └── Worker ───────── public API and security boundary
         ├── auth (KV), authorisation, quotas
         ├── D1 — sole owner of all writes
         ├── non-agentic AI (unchanged)
         └── calls ↓
                   Google Cloud Run
                   ┌──────────────────────────────┐
                   │ Python + FastAPI container   │
                   │   agent orchestration        │
                   │   LLM calls                  │
                   │   retrieval                  │
                   │   document processing        │
                   │   structured output          │
                   │   guardrails                 │
                   └──────────────────────────────┘
```

### Stays on Cloudflare

| Component | Why |
|---|---|
| Pages | static bundle; nothing to gain by moving |
| Worker | security boundary, auth, authorisation, quotas |
| D1 | 61 `.prepare()` call sites across 7 files; migrating means a full rewrite plus a paid database. No benefit today. |
| KV | 10 call sites across 2 files; sessions and magic links |
| DNS / WAF | already fronting everything |

### Added on Google Cloud

| Component | Purpose |
|---|---|
| Artifact Registry | stores the agent image |
| Cloud Run | runs the agent container |
| Secret Manager | LLM API keys, agent-service secrets |
| IAM + Workload Identity Federation | GitHub Actions deploys with no stored JSON key |
| Cloud Logging / Monitoring | container logs, uptime checks, alerts |
| GCS bucket | Terraform remote state (versioned) |

Deferred until there is a concrete requirement: Cloud Storage, Pub/Sub, Cloud
Tasks, Cloud Run Jobs, Cloud Scheduler, Cloud SQL.

**Only one container exists in this design:** `mydeck-agent`. The Worker, D1, KV,
Artifact Registry, Secret Manager and Terraform are not containers.

---

## 4. The extraction boundary

The agentic subtree has exactly one entry point. Measured:

```
ai/toolMessages.js  ←  imported ONLY by ai/agentLoop.js
ai/agentLoop.js     ←  imported ONLY by services/tutor.js
tools/registry.js   ←  imported ONLY by services/tutor.js
```

This is a subtree to cut, not a graph to untangle — a direct consequence of the
existing rule that `ai/` imports nothing from `services/` except `errors.js`.

| Stays in the Worker | Moves to Python (eventually) |
|---|---|
| `services/aiContent.js` + its 3 endpoints | `services/tutor.js` |
| `ai/generateStructured.js`, `extract.js`, `schemas.js`, `prompts/` | `ai/agentLoop.js` |
| `ai/callModel.js`, `ai/providers/` | `ai/toolMessages.js` |
| `ai/usage.js` (quota — writes D1) | `tools/` (registry, repair, defs) |

### The cost of this cut

`callModel` and `providers/` must stay for the non-agentic path, so **provider
access ends up implemented in both languages**. Unlike the two copies of
`classify.js`, this cannot be pinned by a cross-language parity test.

It is tolerable because `AI_MODEL` and `AI_TUTOR_MODEL` are already independent
— the two paths are *permitted* to diverge. Make that divergence deliberate and
documented, not accidental.

---

## 5. What crosses the boundary

All five tools in `ALLOWED_TOOLS`, checked for database access including
transitive imports:

| Tool | D1 | Notes |
|---|---|---|
| `hsk_lookup` | none | `lookupLocal` + MCP fallback |
| `hsk_word_list` | none | |
| `hsk_search` | none | |
| `create_activity` | **reads** | via `listDecks` / `getDeck` — needs deck context supplied |
| `save_words_to_deck` | **writes** | via `createDeck` / `addCard` — the only writer |

Three move cleanly. One needs read context. One needs a write decision (§8.2).

Two more things cross:

**Quota.** `ai/usage.js` writes one `ai_usage_log` row per model step, and
`AI_DAILY_LIMIT_FREE = 60` counts model calls rather than requests. If the loop
runs in Python, the Worker must log based on a step count the agent reports.

**The dictionary.** `hsk-core.json` is 424KB and backs both the `hsk_*` tools and
the corruption defenses below. Shipping it into the Python image creates a third
copy of logic that already exists twice (`classify.js`) — and the existing pair is
only safe because a test fails when they diverge. **Decision: the Worker resolves;
Python never resolves.** See §7.2 for how resolved words cross the wire.

### The invariant most at risk

`CLAUDE.md` documents a **measured** failure: the model corrupts Chinese it
retypes (翻译 → 翰译, 医院 → 疒馆). Three defenses exist because of it — resolved
words pre-seeded as already-executed tool results, `hsk_lookup` intercepted for
seeded words, and `deckSave` re-resolving every word against the index.

All three live in the Worker and depend on `lookupLocal`. They stay there. Python
reasons *over* trusted records; it never manufactures canonical Chinese.

### One defense that needs no work

`summariseResult()` — which bounds attacker-controlled activity results to Han
characters and clamped integers — is called in **`http/routes/zh.js`**, not in
`tutor.js`. It reduces the client payload to `summary.text` *before*
`tutor.respond` is invoked.

It is therefore already on the Worker side of this boundary and the extraction
does not touch it. Worth knowing, because it is the sharpest security invariant in
the tutor path and the obvious assumption is that it moves.

---

## 6. Data ownership

**The Worker is the only writer to D1.** The agent service returns structured
results; the Worker validates them and performs every write.

This is the same rule the Worker already enforces internally — `tools/` contains
no business rules, and every `execute()` delegates to a service so that agents
and HTTP routes enforce identical limits and ownership. Extending it one process
outward keeps ownership, quota and limit enforcement in exactly one place and one
language.

D1 does have an HTTP API, so giving Python direct write access is *possible*. It
is rejected on purpose.

---

## 7. Worker ↔ agent communication

```
Frontend
   ↓  session cookie
Worker
   ├── validates session (KV)
   ├── checks authorisation and quota (D1)
   ├── resolves any Chinese words (lookupLocal)
   └── POST → Cloud Run, shared-secret header
              ↓
         structured JSON result
              ↓
   Worker validates → writes D1 → responds
```

The browser never calls the agent service directly.

Proposed private endpoints: `GET /health`, `GET /version`,
`POST /internal/agent/run`, plus task-specific routes as they are built.

### 7.1 Where the client lives

`integrations/agentService.js`, **not** `services/tutorClient.js`.

Two rules decide this. The convention this repo already follows: `integrations/`
holds outbound third-party HTTP (`resend.js`, `github.js`, `hskMcp.js`);
`services/` holds domain logic that takes `(env, args)` and returns plain data.
The Python service is reached over HTTP, so it is an integration. And the name is
`agent`, not `tutor`, for the reason in §12 — the tutor is the first workload in
that container, not the only one.

`services/tutor.js` stays the composition point it already is — it keeps quota,
the allowlist policy, word resolution and the `saveFailed` contract, and delegates
only the loop. The extraction then changes one import inside `tutor.js` rather
than reshaping a layer.

### 7.2 Words cross as indices, not identifiers

**There are no stable dictionary IDs, and none should be invented.**

Measured: `lookupLocal` is `index().get(word.trim())` — the dictionary is a Map
keyed by the word string itself. `grep -c '"id"' hsk-core.json` returns **0**.
Entries carry `simplified`, `radical`, `frequency_rank`, `levels`, `forms`.

An ID scheme would mean a stable generator, a migration path every time
`npm run hsk:index` regenerates the file, and one more thing to keep in sync.
Instead, the Worker supplies an indexed list and Python refers to positions in it:

```jsonc
// Worker → Python  (built from knownWords(), already per-request)
{
  "known_words": [
    { "i": 0, "simplified": "医院", "pinyin": "yīyuàn", "meaning": "hospital" },
    { "i": 1, "simplified": "银行", "pinyin": "yínháng", "meaning": "bank" }
  ],
  "available_decks": [
    { "id": 1, "name": "HSK 3", "card_count": 45 }
  ]
}

// Python → Worker
{
  "text": "…the tutor's reply…",
  "intended_actions": [
    { "type": "save_words_to_deck", "deck_id": 1, "word_refs": [0, 1] }
  ],
  "model_calls": 3
}
```

Bounded integers, no ID scheme, no migration — and the Worker maps them back to
records it produced itself. This also makes structural something that is currently
only conventional: `CLAUDE.md` already notes that naming words in
`save_words_to_deck` *selects* from `knownWords()` rather than supplying them.

`model_calls` is what the Worker logs to `ai_usage_log`, one row per call.

### 7.3 Authentication, and its sharp edge

Cloud Run's `--no-allow-unauthenticated` requires a **Google-signed ID token**,
which a Worker cannot mint without a service-account key — and this design
forbids stored keys. So v1 is necessarily: public ingress plus a shared secret
held in both Cloudflare secrets and Secret Manager.

That means the agent URL is internet-reachable and the secret is the only gate.
Required mitigations:

- constant-time comparison of the secret
- rate limiting
- rotation procedure written down before launch
- the agent URL never reaches the frontend bundle
- **put Cloud Run behind a proxied Cloudflare custom domain**, so the existing
  WAF and rate limiting apply to it. This costs nothing and reuses infrastructure
  already in place.

---

## 8. Decisions

Settled on 2026-08-07. What remains open is in §13 — deliberately short, because
an undecided item here blocks §11.

### 8.1 The 中文 tutor moves to Python — decided

Not "new capabilities first, tutor later". The tutor *is* the first workload.

Two reasons, and the first is the only measured one in this document: the agent
loop is the sole thing pressed against the 30s wall clock (§2), so relocating
anything else leaves the actual constraint in place. Second, retrieval, document
ingestion and evaluation are intended (§8.3), and those belong in the same service
as the agent that will use them — building the service around an unrelated
capability and retrofitting the tutor later is more work, not less.

The risk — that a Python port starts at zero test coverage against 355 tests —
is handled by the staged migration in §11, not by deferring.

### 8.2 The Worker executes writes after the loop — decided

Python returns *intended* actions (§7.2); it never calls back mid-loop and never
touches D1. On receiving them the Worker:

1. verifies deck ownership
2. maps `word_refs` back to its own trusted records
3. checks save intent
4. performs the D1 writes
5. records actual successes and failures
6. constructs the final `saveFailed`

**This is compatible with the existing contract**, which is why it is safe:
`tutor.js` already computes `saveFailed = saveAttempts > 0 && saves.length === 0`
*after* the loop. `saveAttempts` becomes "what the model asked for" and `saves`
becomes "what actually landed" — the same two quantities, sourced one process
apart.

Worker callbacks mid-loop are introduced **only** if a later tool genuinely needs
a write result to continue reasoning. No current tool does.

> **Known regression, accepted.** Today the tool result tells the model which
> words were `skipped` as unresolvable, and it can mention them in its reply.
> Post-loop execution means it cannot. `saveFailed` still prevents a false claim
> of success, so this costs UX detail, not safety.

### 8.3 Python, not Node — decided

Justified by what is coming, not by the loop itself. Retrieval, embeddings, PDF
and document ingestion, and evaluation tooling are all intended, and all are
materially better served in Python. Had the container been only "the same loop
with a longer timeout", Node would have been cheaper — it would reuse `ai/` and
`tools/` and avoid a second provider implementation.

Accept going in that the port re-solves two problems already solved here:
`tools/repair.js` exists because models get argument types wrong on essentially
every call, and `toolMessages.js` exists because provider tool-message shapes
differ. Pydantic AI and instructor handle both well, but this is re-solving, not
avoiding.

### 8.4 Provider duplication is intentional — decided

`callModel` and `providers/` exist in both languages. Do **not** build a shared
provider service to remove it: that adds a network hop and couples two paths whose
whole point is independence.

Document the split so it stays deliberate:

| Var | Owner | Profile |
|---|---|---|
| `AI_MODEL` | Worker (JS) | short structured generation, one call, fast JSON |
| `AI_TUTOR_MODEL` | Cloud Run (Python) | long agentic turns, tool-capable, 1–4 calls |

They may legitimately diverge on model, provider, timeout and retry policy.

### 8.5 Environments

Start with one project (`mydeck-linsnotes`) and two Cloud Run services
(`mydeck-agent-dev`, `mydeck-agent-prod`). Separate projects per environment is
the stronger isolation and can come later.

---

## 9. CI/CD ownership

**Terraform owns infrastructure. Wrangler owns Worker source. Never both.**

This was the decision `infrastructure/README.md` flagged as required before any
`.tf` file exists. It is now settled.

| Owner | Owns |
|---|---|
| Terraform | Artifact Registry, Cloud Run service config, Secret Manager containers, service accounts, IAM, GitHub OIDC, monitoring, alerts, relevant Cloudflare resources |
| Wrangler | the Worker script itself |
| Cloudflare Pages | the frontend bundle |

Pull requests run checks only, never deploys: lint and test all three packages,
build the frontend, build the image, `terraform fmt` / `validate` / `plan`.

Deploys are per-target and path-filtered, so a copy change in the frontend does
not redeploy the API. Every deploy ends with a smoke test — see
[.github/workflows/README.md](../.github/workflows/README.md), which shows why
asserting on `/version` catches a silent rollback that `/health` cannot.

Terraform applies only from a reviewed merge, never from a pull request.

---

## 10. Secrets

| Store | Holds |
|---|---|
| Cloudflare secrets | `RESEND_API_KEY`, GitHub OAuth pair, `AI_API_KEY`, agent shared secret |
| Google Secret Manager | LLM API keys, tracing keys, agent shared secret |
| GitHub Actions secrets | scoped Cloudflare deploy token only |
| Google credentials | **none stored** — Workload Identity Federation |

Never in: git, `.tfvars`, Docker images, `.env.example`, `wrangler.toml.example`.

Terraform state records resource attributes in plaintext, so a secret passed
through a Terraform variable becomes a secret stored in the state bucket. Secret
Manager holds the *containers*; values are set out of band.

---

## 11. Sequencing

Nothing below is started. **The JavaScript tutor stays live and authoritative
until step 8.** Each step leaves the app fully working.

1. **Define the Worker ↔ Python contract** (§7.2) and write it down as schemas on
   both sides before either exists. This is the artefact steps 2 and 3 are built
   against.
2. **Write the contract tests.** These do not "port" — they *split*.
   `backend/test/tutor.test.js` currently drives a scripted model and asserts
   against D1, which Python cannot do. It becomes:
   - Python: given this scripted model, the agent returns these `intended_actions`
   - Worker: given these `intended_actions`, these D1 rows appear and `saveFailed`
     is correct

   Both halves are writable before the service exists.
3. **Build `services/agent-service/` locally** — `/health`, `/version`, then the
   agent loop. Run it as a container locally. No cloud resources yet.
3b. **Build the Worker's composition path against the fixed response.** Added
   after step 3 was done, and it belongs before the cloud work rather than after
   it: flag selection, the request build, policy validation, action
   materialisation, the fallback policy and shadow mode are all Worker-side, all
   testable against a local container, and all independent of what the loop
   eventually does. Doing it here means porting the loop later changes one
   process instead of changing routing, persistence, contracts and agent
   behaviour at once.
4. **Terraform the GCP bootstrap** — project, state bucket, Artifact Registry,
   OIDC. Still nothing deployed.
5. **Deploy `mydeck-agent-dev` to Cloud Run** via Terraform. The pipeline is the
   deliverable; correctness comes next.
6. **Shadow mode** — the Worker calls Python alongside its own tutor, compares,
   logs divergence, and discards the Python result. See the warning below.
7. **Flag it on for your own account.** Python authoritative for one user, JS for
   everyone else, instant flip back.
8. **Make Python authoritative**, JS retained as rollback.
9. **Delete the JS agent subtree** — `services/tutor.js`, `ai/agentLoop.js`,
   `ai/toolMessages.js`, `tools/` — after the rollback window closes. **Keep
   everything non-agentic** (§4).

Do not create Artifact Registry or Cloud Run before the container runs locally.

> ### Shadow mode doubles AI consumption
>
> Every shadowed turn runs both implementations, so:
>
> - `AI_DAILY_LIMIT_FREE = 60` counts **model calls**, so the effective per-user
>   limit halves.
> - Workers AI's 10,000 neurons/day is **account-wide**, not per user. The
>   existing estimate in `wrangler.toml.example` is ~45 neurons per tutor call and
>   1–4 calls per turn — roughly 50–200 turns/day before error 4006.
>
> So: shadow **only** your own account, and do **not** write shadow calls to
> `ai_usage_log`. Otherwise step 6 exhausts the quota for real users.

---

## 12. Naming to reconcile

The source plan for this document used names that do not match the tree. Where
they differ, **the tree wins** unless deliberately renamed:

| Plan | Actual |
|---|---|
| `backend/tests/` | `backend/test/` (27 files) |
| `frontend/tests/` | colocated in `frontend/src/` — `vite.config.js` scopes `test.include` to `src/**/*.test.{js,jsx}`, and three tests import backend source via `../../../../backend/src/...`. Moving them breaks both. |
| `wrangler.example.toml` | `wrangler.toml.example` |
| `backend/src/routes/` | `backend/src/http/routes/` |
| `backend/src/usage.js` | `backend/src/ai/usage.js` |
| `services/tutorClient.js` | `integrations/agentService.js` — see §7.1 |
| Dockerfile in `deploy/` *and* the service directory | pick one — keep it with the service, where the build context is |
| `scripts/check.sh` | `npm run check` already exists |

### One name, everywhere

The source plans used `tutor-service` for the directory and `mydeck-agent` for the
image and Cloud Run service. Pick one — a directory that disagrees with the image
it builds is a small, permanent tax on every runbook and CI file.

**Use `agent` throughout**, because §8.3 commits to retrieval and ingestion living
here too, so `tutor` will be wrong within a release or two:

```
services/agent-service/                      directory
backend/src/integrations/agentService.js     the Worker's client (§7.1)
mydeck-agent                                 image name
mydeck-agent-dev / mydeck-agent-prod         Cloud Run services
asia-southeast1-docker.pkg.dev/mydeck-linsnotes/mydeck-images/mydeck-agent:<sha>
```

The list is the whole set on purpose. §7.1 named the client `tutorService.js`
while this section said "use `agent` throughout", and one line disagreeing with
another is how the tax gets paid anyway.

`docs/operations.md` and `docs/secrets.md` are named in the plan and genuinely do
not exist. They are worth writing when there is something to operate.

---

## 13. Still open

- **Whether mid-loop callbacks are ever needed** (§8.2). No current tool requires
  a write result to continue reasoning. Revisit only when one does.
- **Whether the agent service needs to split** once retrieval and ingestion land
  beside the tutor — one Cloud Run service, or an api/worker pair sharing an image
  (§3).
- **Separate GCP projects per environment** (§8.5) — one project for now.
- **`docs/operations.md` and `docs/secrets.md`** — worth writing once there is
  something to operate.

### Explicitly rejected, do not relitigate without new information

- **Leaving D1 or KV.** 61 `.prepare()` call sites across 7 files, 18 of 27
  backend test files bound to `cloudflare:test`, and a paid database replacing a
  free one — for no capability the app needs.
- **Moving the non-agentic AI path.** Three endpoints, no tools, short structured
  requests that already work well in the Worker and gain nothing from a network
  hop (§4).
- **A shared provider service** to remove the JS/Python duplication (§8.4).
- **Kubernetes.** Cloud Run is the target. A cluster is justified by several
  services and their networking, not by one container.
- **Python writing to D1 directly** (§6), even though the D1 HTTP API makes it
  possible.
- **Inventing dictionary IDs** (§7.2). Indices into a Worker-supplied list do the
  same job with no ID scheme and no regeneration migration.
