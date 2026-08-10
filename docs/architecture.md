# Architecture — the migration, and the record of how it was done

> **Status: §11 complete — all nine steps. The 中文 tutor is
> `services/agent-service` on Cloud Run and nothing else. The Worker's own agent
> loop is deleted, so there is no fallback: every failure of that hop costs the
> learner the tutor's prose, and the word cards are the floor that makes it safe.**
>
> [structure.md](structure.md) describes what the repository *is*. This document
> described where it was *going*, and it arrived — so read it as a decision
> record. §1 is deliberately left in the past tense: it is the starting state
> every later argument reasons *from*, and updating it would turn those arguments
> into conclusions about a system that never existed.
>
> The parts that are still live guidance rather than history: §5 (what may cross
> the boundary), §7 (the contract), §8 (the decisions), §9–§10 (CI/CD and
> secrets), §13 (what is still open — and turn latency is now a live defect with
> nothing behind it).
>
> Last revised: 2026-08-10. Every number and import claim below was measured
> against the tree at the date it was written; re-measure before trusting them.

---

## 1. Today

> **This section describes the state this document set out to change, before
> §11.** It is left in the past tense rather than updated, because everything
> after it is an argument *from* this starting point and rewriting it would make
> those arguments read as conclusions about a system that no longer exists. For
> what runs now, see §3 (target — reached) and §11 step 9.

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

One Worker held authentication, authorisation, all business logic, both AI paths
and every database write. It was the whole backend and the whole security
boundary.

### The two AI paths

They were already separate — this matters more than anything else in this
document, so it is stated first. The separation is why one of them could leave
without the other noticing:

```
NON-AGENTIC   routes/ai.js → aiContent.js → generateStructured → callModel
              no tools, one model call, JSON extracted and validated
              3 endpoints: generate-flashcards, generate-vocab,
                           generate-comprehension
              ── unchanged, still in the Worker ──

AGENTIC       routes/zh.js → tutor.js → runAgent → callModel ⇄ execute
              tools attached, 1–4 model calls per turn
              1 endpoint: POST /api/zh/turn
              ── now routes/zh.js → tutor.js → the agent service ──
```

`services/aiContent.js` imported neither `agentLoop` nor `registry`. The
separation was real and enforced by the module graph, which is what §4 measured.

The configuration agreed: `AI_MODEL` and `AI_TUTOR_MODEL` were independent vars,
and quota accounting already differed — `aiContent` logs once per request, while
`tutor.respond` writes one `ai_usage_log` row per model call. Both are still
true; the tutor's count now arrives from another process.

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

**Cut, as of §11 step 9.** The right-hand column below is deleted from the
Worker; the left-hand column is untouched and still runs there. This section is
kept because the *reason* the cut was cheap is a property worth not losing.

The agentic subtree had exactly one entry point. Measured, before the cut:

```
ai/toolMessages.js  ←  imported ONLY by ai/agentLoop.js
ai/agentLoop.js     ←  imported ONLY by services/tutor.js
tools/registry.js   ←  imported ONLY by services/tutor.js
```

That made it a subtree to cut, not a graph to untangle — a direct consequence of
the existing rule that `ai/` imports nothing from `services/` except `errors.js`.
Keep that rule. It is what turned "move the agent out of process" into a
deletion rather than a refactor.

| Stayed in the Worker | Moved to Python |
|---|---|
| `services/aiContent.js` + its 3 endpoints | `services/tutor.js`'s `runLocal` |
| `ai/generateStructured.js`, `extract.js`, `schemas.js`, `prompts/` | `ai/agentLoop.js` |
| `ai/callModel.js`, `ai/providers/` | `ai/toolMessages.js` |
| `ai/usage.js` (quota — writes D1) | `tools/` (registry, repair, defs) |
| **`services/tutor.js` itself** | |

**The last row is the one that had to be right.** This table originally put the
whole of `services/tutor.js` in the right-hand column, and that is wrong in a way
that would have deleted the write path if followed. What moved was the *loop* —
`runLocal` and what only it used. What stayed is everything the Worker must keep
doing: `runRemote`, the four policy checks, action materialisation and
`saveFailed`. (`agentMode` was on that list too, and went with the flags — with
one implementation there is no mode to pick.)

That is §8.2 — **the Worker writes, the agent asks** — and it is the reason the
agent can be given a model with no database, no session and no way to know
whether a save is authorised. Moving `tutor.js` would have moved the thing that
decides. The file got smaller; it did not leave.

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

A **measured** failure, and the one this whole section exists for: the model
corrupts Chinese it retypes (翻译 → 翰译, 医院 → 疒馆). Three defenses exist
because of it — resolved
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

This was the same rule the Worker already enforced internally, back when it had
tools of its own: `tools/` held no business rules and every `execute()`
delegated to a service, so an agent and an HTTP route enforced identical limits
and ownership. Step 9 deleted that layer, and the rule outlived it unchanged —
`services/` is still the only place limits and ownership are decided, and
`services/tutor.js` reaches it on the agent's behalf exactly as a route does.
Extending it one process outward keeps enforcement in one place and one
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
  "decks": [
    { "id": 1, "name": "HSK 3", "card_count": 45 }
  ]
}

// Python → Worker
{
  "message": "…the tutor's reply…",
  "intended_actions": [
    { "type": "save_words_to_deck", "deck_id": 1, "word_refs": [0, 1] }
  ],
  "usage": { "model_calls": 3 }
}
```

Bounded integers, no ID scheme, no migration — and the Worker maps them back to
records it produced itself. This also makes structural something that was
previously only conventional: naming words in `save_words_to_deck` *selects*
from `knownWords()` rather than supplying them, and omitting the refs still
means "what we have been discussing".

`model_calls` is what the Worker logs to `ai_usage_log`, one row per call.

### 7.3 Authentication, and its sharp edge

Cloud Run's `--no-allow-unauthenticated` requires a **Google-signed ID token**,
and the Worker has no configured flow for minting one. Note the shape of that
claim: it is a statement about what is built, not about what Cloudflare can do.
Workload Identity Federation trusts any OIDC issuer, so a Worker signing its own
JWT against a published JWKS would authenticate keylessly. That is a real option
— it costs a signing key in Worker secrets and a JWKS endpoint to serve.

So v1 is public invocation plus a shared secret held in both Cloudflare secrets
and Secret Manager: fewer moving parts, and no long-lived Google service account
key in Cloudflare. Revisit when there is a reason to, not because it is
impossible.

**The application is therefore the authorization boundary, not Cloud Run IAM.**
`app/main.py:require_secret` compares with `hmac.compare_digest`, 401s a
mismatch, and 503s when the secret is unset while `K_SERVICE` is present, so an
unconfigured deployment refuses to serve rather than serving to everyone.

Mitigations, and their honest status:

| | |
|---|---|
| constant-time comparison | done — `hmac.compare_digest` |
| rotation procedure written down | done — [secrets.md](secrets.md) |
| the agent URL never reaches the frontend bundle | done — the Worker holds it |
| rate limiting | **not built** |
| a perimeter that cannot be bypassed | **not built** — see below |

**A proxied Cloudflare custom domain is not a perimeter.** An earlier version of
this section claimed it was, and that was wrong: fronting Cloud Run with a
Cloudflare hostname applies the WAF and rate limits to traffic that goes
*through* Cloudflare, while the default `*.run.app` endpoint stays directly
reachable. Anyone with the URL skips all of it. The URL is not a secret and
nothing should be designed as though it were.

Closing that requires restricting ingress so direct requests are refused:

```
Cloudflare → Google External Application Load Balancer → Cloud Run
             ingress = INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER
             optionally with the default run.app URL disabled
```

This is a `run-prod/` decision and is listed in §13.

**The secret is now the only control, and that changed under this section
without it being rewritten.** `run-dev/` was described here as reachable by one
allowlisted account through a Worker whose flags were all off — true at step 7,
when `AGENT_ALLOWED_USERS` named a single address. Step 8 opened the tutor to
every learner and step 9 deleted the flags, so the "one account" half of that
sentence stopped being true twice over. Ingress is public, every learner's turn
reaches the service, and `AGENT_SERVICE_SECRET` is what stands between the two.
§13 has always said this correctly in the past tense; this section said the
opposite in the present, which is the worse of the two to leave standing.

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

*Settled, in the end:* LangChain's `create_agent` absorbed both, so neither
needed a Python counterpart — which is why `app/agent/state.py` holds only the
things a framework does not give you (the allowlist checked where tools run, the
tool budget, seed interception, `save_attempts` counted before any refusal).
Step 9 then deleted the JavaScript originals, so the re-solving cost was paid
once rather than carried.

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

The two services are not the same shape, and the difference is measured rather
than stylistic:

| | dev | prod |
|---|---|---|
| `min_instances` | 0 | **1** |
| first request after idle | ~23.6s | ~2–6s |
| cost when idle | nothing | one instance, billed continuously |

Shadow mode on 2026-08-09 put a cold turn at **23,626 ms** against a 25s Worker
timeout — a 1.4s margin, where a timeout is rethrown and the learner loses the
prose. About 17.8s of that is Python starting and LangChain importing.
`AGENT_DEADLINE_S` cannot help: Cloud Run holds the request while the container
boots, so the agent's clock starts after the cost is already paid, and that turn
reported `stopped_by: "answered"`.

Dev keeps 0 because the only person paying a cold start is whoever is testing.
This is the first continuously billed resource in the project, so it belongs to
`run-prod/` and not before. Full numbers in
[infrastructure/README.md](../infrastructure/README.md).

---

## 9. CI/CD ownership

**Terraform owns infrastructure. Wrangler owns Worker source. Never both.**

This was the decision `infrastructure/README.md` flagged as required before any
`.tf` file exists. It is now settled.

| Owner | Owns |
|---|---|
| Terraform — GCP | Artifact Registry, Cloud Run service config, Secret Manager containers, service accounts, IAM, GitHub OIDC (WIF), monitoring, alerts |
| Terraform — Cloudflare | DNS records, zone settings, Pages project, the D1 database and KV namespace **as containers** |
| Terraform — GitHub | repository ruleset, environments, non-secret Actions variables |
| Wrangler | the Worker script — body, bindings, vars, secrets |
| Cloudflare Pages | the frontend bundle |

The Worker line is not a preference. `cloudflare_workers_script` carries
`content`, `bindings`, `compatibility_date`, `observability` and `limits` as
**one resource** — the same set `backend/wrangler.toml` declares and `wrangler
deploy` uploads. There is no seam: whichever tool uploads the script owns its
bindings. So Terraform creates the D1 database and the KV namespace, and
`wrangler.toml` binds them. The `database_id` is copied across by hand, which is
the price of the split and is cheaper than the drift.

The same applies to routes. `[[routes]]` in `wrangler.toml` **or**
`cloudflare_workers_route` — declaring both is drift by construction.

`cloudflare_workers_secret` was removed in provider v5, so Cloudflare secret
values stay with `wrangler secret put` without anyone having to enforce §10.

### 9.1 Three providers, three lifecycles

The providers are not three copies of the same exercise. Each is a different
Terraform discipline, which is why all three earn their place:

| Provider | Lifecycle | Why it is different |
|---|---|---|
| Google | **create** | Greenfield. Terraform is the only thing that has ever touched these resources. |
| Cloudflare | **import / adopt** | D1, KV, DNS and Pages already exist and hold live data. `terraform import`, never re-create. |
| GitHub | **govern / connect** | SaaS configuration that surrounds the repo, plus the wiring between the other two. |

Cloudflare D1 and KV carry `lifecycle { prevent_destroy = true }`, the same
treatment as the state bucket. A replacement drops user data, which makes them
higher-stakes than anything in `bootstrap/` or `artifact-registry/`.

### 9.2 One provider per root module

Each directory under `infrastructure/terraform/` is its own root module with its
own state prefix in the shared GCS bucket. That already held for the GCP
modules; `cloudflare/` and `github/` extend the pattern rather than breaking it.

```text
terraform/
├── bootstrap/           google
├── artifact-registry/   google
├── iam/                 google
├── secrets-dev/         google
├── run-dev/             google
├── cloudflare/          cloudflare
└── github/              github
```

**Do not collapse these into one root module with three providers.** The point
is blast radius: an apply in `cloudflare/` cannot touch Cloud Run, an apply in
`github/` cannot touch DNS. Multi-provider is a property of the repository, not
of a module.

### 9.3 `github/` publishes infrastructure outputs

The GitHub module's operational job — as distinct from governance — is to carry
non-secret Terraform outputs into the CI environment, so no long identifier is
ever pasted into YAML by hand:

```text
GCP Terraform outputs → github/ → Actions variables → deploy workflow
```

Artifact Registry URI, WIF provider resource name, deploy service account email,
Cloud Run service name, region. All read via `terraform_remote_state` from the
GCP modules' state prefixes; all non-secret, which is what keeps this clear of
§10. A WIF provider name is a long resource path nobody types correctly twice.

**The repository is public, so treat these as published.** Workflow logs on a
public repo are world-readable, and any variable a step echoes is in them. That
is fine — WIF's security rests on the provider's `attribute_condition`, not on
the provider name being obscure. But it is only fine if that condition actually
pins the repository:

```hcl
attribute_condition = "assertion.repository_owner == 'kuibinlin' && assertion.repository == 'kuibinlin/mydeck'"
```

Owner *and* repository. A condition matching on `repository_owner` alone, or
absent entirely, lets any GitHub Actions workflow anywhere mint tokens for the
service account — and a public repo hands an attacker every identifier needed to
try. `iam/` is where this is enforced.

**No Actions secrets.** `github_actions_secret` requires the *value*, so
Terraforming one puts it in state in plaintext — see §10. Secrets are set
through the GitHub UI or `gh`, out of band, exactly as Secret Manager values are.

### 9.4 Where applies run

Pull requests run checks only, never deploys: lint and test all three packages,
build the frontend, build the image, `terraform fmt` / `validate` / `plan`.

Deploys are per-target and path-filtered, so a copy change in the frontend does
not redeploy the API. Every deploy ends with a smoke test — see
[.github/workflows/README.md](../.github/workflows/README.md), which shows why
asserting on `/version` catches a silent rollback that `/health` cannot.

Terraform applies only from a reviewed merge, never from a pull request —
**except `github/`, which applies locally.** Its provider credential is a
repo-admin PAT; held in Actions secrets it would be a credential stored inside
the thing it governs, able to delete the branch protection that made the merge
"reviewed". Repository governance changes roughly never, so a manual apply costs
nothing and the trust loop disappears.

---

## 10. Secrets

| Store | Holds |
|---|---|
| Cloudflare secrets | `RESEND_API_KEY`, GitHub OAuth pair, `AI_API_KEY`, agent shared secret |
| Google Secret Manager | LLM API keys, tracing keys, agent shared secret |
| GitHub Actions secrets | the Cloudflare **deploy** token only |
| Google credentials | **none stored** — Workload Identity Federation |
| Local only | the Cloudflare **Terraform** token, the GitHub PAT |

Never in: git, `.tfvars`, Docker images, `.env.example`, `wrangler.toml.example`.

Terraform state records resource attributes in plaintext, so a secret passed
through a Terraform variable becomes a secret stored in the state bucket. Secret
Manager holds the *containers*; values are set out of band. The same rule is why
`github/` manages Actions *variables* and never Actions secrets (§9.3).

**Two Cloudflare tokens, not one.** They differ in scope, lifetime and holder,
and reusing one for both jobs hands CI the ability to rewrite DNS:

| Token | Held by | Scopes |
|---|---|---|
| deploy | GitHub Actions | Workers Scripts:Edit |
| Terraform | your machine | Zone:DNS:Edit, D1:Edit, Workers KV Storage:Edit, Pages:Edit |

---

## 11. Sequencing

**Done — all nine steps.** The JavaScript tutor stayed live and authoritative
until step 8, and every step left the app fully working. What follows is kept as
the record of how it got here, because the order was the point: each step could
be reverted on its own, and step 9 is the only one that could not have been done
early.

The two caveats this section used to carry were both resolved before step 8, and
one of them resolved by finding a bug:

- **A real provider has been behind the loop.** `aisingapore/Qwen-SEA-LION-v4-32B-IT`
  via SEA-LION, called directly against the deployed service. It calls tools,
  respects the allowlist, and populates `discovered_words`.

  It also **failed the first turn in the exact way `wrangler.toml.example`
  warns about** — asked "什么是水" with nothing seeded, it skipped `hsk_lookup`
  and asserted 水 is not in HSK. It is HSK 1. The cause was not the model: the
  prompt forbade *stating* an unsourced fact but never required the *call*, and
  it supplied the sentence to use on a `found:false` result, so the model
  reached for that sentence without earning it. Both language copies had it.
  Fixed, and pinned at the time by `test_prompt_parity.py`, which held the two
  copies together. Step 9 removed the second copy; the rule itself is still
  pinned, by `services/agent-service/tests/test_prompt.py`.

  **No scripted test could have caught this**, which is the argument for doing
  step 6 rather than trusting green suites: a scripted model calls the tool
  because the script says to.

- **CI's permission chain works end to end.** `run-dev/` granted the missing
  `roles/run.developer`, and a real `gcloud run deploy` exercised push → deploy
  → verified revision. `/version` reports the revision that `gcloud` says is
  serving.

1. **Define the Worker ↔ Python contract** (§7.2) — *done.* and write it down as schemas on
   both sides before either exists. This is the artefact steps 2 and 3 are built
   against.
2. **Write the contract tests** — *done.* These do not "port" — they *split*.
   `backend/test/tutor.test.js` currently drives a scripted model and asserts
   against D1, which Python cannot do. It becomes:
   - Python: given this scripted model, the agent returns these `intended_actions`
   - Worker: given these `intended_actions`, these D1 rows appear and `saveFailed`
     is correct

   Both halves are writable before the service exists.
3. **Build `services/agent-service/` locally** — *done.* `/health`, `/version`, then the
   agent loop. Run it as a container locally. No cloud resources yet.
3b. **Build the Worker's composition path against the fixed response** — *done.* Added
   after step 3 was done, and it belongs before the cloud work rather than after
   it: flag selection, the request build, policy validation, action
   materialisation, the fallback policy and shadow mode are all Worker-side, all
   testable against a local container, and all independent of what the loop
   eventually does. Doing it here means porting the loop later changes one
   process instead of changing routing, persistence, contracts and agent
   behaviour at once.
4. **Terraform the GCP bootstrap** — *done.* Project, state bucket, Artifact
   Registry, OIDC, applied as `bootstrap/`, `artifact-registry/` and `iam/`.
   Still nothing deployed, and CI cannot yet ship a revision — `run.developer` is
   scoped to a service that does not exist.
5. **Deploy `mydeck-agent-dev` to Cloud Run** via Terraform — *done.*
   `secrets-dev/` first (the service mounts `AGENT_SERVICE_SECRET` at creation),
   then `run-dev/`, then an image built `--platform linux/amd64` and shipped
   with `gcloud run deploy`. The pipeline was the deliverable and it works;
   correctness is step 6.
6. **Shadow mode** — *done.* The Worker called Python alongside its own tutor
   and discarded the result. Four turns, and the two implementations agreed on
   every one — same `stoppedBy`, same tool calls, same absence of save attempts.
   What it could not test is writes, because shadow never materialises an
   action. It did produce the cold-start measurement (§8.5).
7. **Flag it on for your own account** — *done.* Python authoritative for one
   user, JS for everyone else, instant flip back. Confirmed by the write
   landing, not by absence of errors: a turn asked to save, Cloud Run answered
   200 in 3.2s, and two rows appeared in D1 four seconds later with correctly
   formed Chinese — so the indices-not-characters contract (§7.2) held through a
   real model. `ai_usage_log` rows appeared in pairs, one per model call, which
   only happens on the remote path.

   Still unproven: the `deck_name` branch, where Python asks for a *new* draft
   deck rather than writing into one already offered. Creating a deck is the
   more consequential half of `save_words_to_deck`.
8. **Make Python authoritative**, JS retained as rollback — *done.* One line:

   ```diff
   -AGENT_ALLOWED_USERS = "kuibin.dev@gmail.com"
   +AGENT_ALLOWED_USERS = "*"
   ```

   `"*"` was a wildcard rather than a reinterpretation of empty, and the
   distinction was load-bearing. Treating an absent allowlist as universal would
   mean a deleted line, a typo, or an unset variable in a fresh environment
   silently moving every learner onto the remote path. `"*"` cannot be arrived at
   by omission.

   `AGENT_ENABLED` decided *whether* anyone moved; the allowlist only said *who*.
   Both were in `backend/wrangler.toml`, committed, so this was a reviewable PR
   with CI behind it and `git revert` as the rollback.
9. **Delete the JS agent loop** — *done.* `runLocal` in `services/tutor.js`,
   plus `ai/agentLoop.js`, `ai/toolMessages.js` and `tools/`: 828 lines of source
   and four test files. Everything non-agentic stayed (§4) — flashcard and quiz
   generation still run `generateStructured` → `callModel` in this process, and
   `ai/providers/` still serves them.

   **`services/tutor.js` itself stayed.** An earlier version of this list named
   it for deletion, and following that literally would have removed the write
   path: `runRemote`, the four policy checks, the action materialisation and
   `saveFailed` all live there. That is the Worker's half of §8.2 — *the Worker
   writes, the agent asks* — and it survives the migration by design. The file
   got smaller, not removed.

   The three flags went with the loop. `AGENT_ENABLED`, `AGENT_SHADOW` and
   `AGENT_ALLOWED_USERS` all existed to choose between two implementations, and
   with one there is nothing left to choose. What replaced them is a question
   with an answer: is the service configured? An unset `AGENT_SERVICE_URL` skips
   the tutor and answers with the cards, which is what makes `wrangler dev`
   useful without a container.

   **What this costs, stated plainly.** Every failure of the hop now costs the
   learner the tutor's prose. Before, a transport error, a bad status, an
   unreadable body or a policy refusal fell through to the in-process loop and
   nobody noticed; only a timeout degraded. Now they all degrade. That is the
   point of the step rather than a regression accepted alongside it — a fallback
   nobody can observe firing is not a safety net, it is a second implementation
   whose behaviour you have stopped checking.

   **The floor did not move**, and it is the reason this was safe. `routes/zh.js`
   resolves the word cards from the bundled dictionary *before* the tutor is
   called, so a turn with no tutor at all is still a correct answer.
   `zh.test.js` pins that against a 500, an unreadable body and an exhausted
   quota.

   **Two parity tests changed shape.** `test_prompt_parity.py` is gone — it held
   the Worker's copy of the system prompt against Python's, and there is no
   second copy now; the load-bearing rules are still pinned, against the one copy
   (`test_prompt.py`). `test_tool_parity.py` is new and does the opposite: the
   tool allowlist still exists in both languages, so it fails when they diverge,
   in either direction.

   The gate for this step was a count, not a date: run step 8 and watch
   `[agent] remote fallback`. It was decided on the other argument instead —
   with the remote path serving every learner, the fallback was a duplicate
   implementation being maintained, tested and reasoned about for a case nobody
   had observed. That is a defensible call and it is not the one this list
   originally described; the honest summary is that the deletion was chosen for
   simplicity rather than earned by data.

Do not create Artifact Registry or Cloud Run before the container runs locally.

**`cloudflare/` and `github/` are not on this path.** The numbered steps are the
agent service's critical path, and neither module blocks any of them. Do
`cloudflare/` once the GCP chain is through step 5, and `github/` after that,
since it reads the outputs of `artifact-registry/`, `iam/` and `run-dev/` (§9.3).

`github/` should stay small — a ruleset, environments, and variables read from
remote state. If it grows past roughly sixty lines it has stopped being
governance and started being Terraform for its own sake.

> ### Shadow mode doubled AI consumption — historical, step 6 only
>
> Kept because the reasoning generalises to the next thing that wants to run two
> implementations at once, not because any of it is still live. Shadow mode went
> with step 9.
>
> Every shadowed turn ran both implementations and discarded one, so the spend
> was two turns for one answer.
>
> **Where that landed depended on which providers were configured.** With
> `AI_DEFAULT_PROVIDER="cloudflare"` it was the **account-wide** Workers AI
> allowance — 10,000 neurons/day, roughly 50–200 tutor turns at ~45 neurons per
> call and 1–4 calls per turn, then error 4006 for everyone. With an API-key
> provider it was whatever `AI_API_KEY` billed. The two sides could also be on
> different providers: the Worker read `AI_DEFAULT_PROVIDER`, the agent service
> reads its own `AI_PROVIDER`.
>
> What it did **not** cost was the learner's quota: `shadow()` wrote no
> `ai_usage_log` row, so `AI_DAILY_LIMIT_FREE` was untouched and the per-user
> limit did not halve.
>
> So: shadow **one** account, never globally. A comparison doubles the bill for
> every turn the product serves, to produce answers nobody reads.

---

## 12. Naming to reconcile

The source plan for this document used names that do not match the tree. Where
they differ, **the tree wins** unless deliberately renamed:

| Plan | Actual |
|---|---|
| `backend/tests/` | `backend/test/` (25 suites) |
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
mydeck-agent-dev-runtime / -prod-runtime     the identity each service runs as
asia-southeast1-docker.pkg.dev/mydeck-linsnotes/mydeck-images/mydeck-agent:<sha>
```

The runtime identities carry the environment because there is one per service,
not one shared — `secrets-<env>/` grants `secretAccessor` per secret, and two services
sharing an account are one IAM principal, so no per-secret grant could keep
prod's secrets out of dev's reach. `mydeck-deploy` is the deliberate exception:
one CI identity for the project, restricted by ref rather than by environment
(§9.4).

The list is the whole set on purpose. §7.1 named the client `tutorService.js`
while this section said "use `agent` throughout", and one line disagreeing with
another is how the tax gets paid anyway.

`docs/operations.md` is named in the plan and genuinely does not exist; it is
worth writing when there is something to operate. `docs/secrets.md` now exists —
setting, verifying and rotating every secret across all three stores.

---

## 13. Still open

- **Whether mid-loop callbacks are ever needed** (§8.2). No current tool requires
  a write result to continue reasoning. Revisit only when one does.
- **Whether the agent service needs to split** once retrieval and ingestion land
  beside the tutor — one Cloud Run service, or an api/worker pair sharing an image
  (§3).
- **Separate GCP projects per environment** (§8.5) — one project for now.
- **The production ingress perimeter** (§7.3). `run-dev/` is public invocation
  plus the application secret, which is right for dev. `run-prod/` picks between
  keeping that, or Cloudflare → Google external load balancer → Cloud Run with
  `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` and the default `run.app` URL
  disabled. The second is the stronger answer; decide before step 8, not during.
- **Turn latency against the model provider. Still the largest open question,
  and it no longer has a fallback behind it.**
  Measured 2026-08-09 on a *warm* prod container: one lookup turn took **29.8s**
  and hit the 20s deadline, returning `stopped_by: "step_limit"` and an empty
  message — where dev's comparable turns run 3–6s. Through the Worker that turn
  produces nothing: `AGENT_SERVICE_TIMEOUT_MS` fires at 25s, a timeout is
  rethrown, and `routes/zh.js` degrades to the cards.

  Not diagnosed. `usage.model_calls` was 1, so the second call never completed,
  and the 20s covers model call 1 plus the `hsk_lookup` round trip — which from
  Cloud Run goes to the *public* `hsk-mcp.linsnotes.com` (no service binding
  available there), rate limited 30/min per IP with `HSK_TIMEOUT_S` at 8s. So a
  slow dictionary hop and a slow model are both plausible and they are
  distinguishable: compare a turn that uses no tool against one that does.

  Also unexplained at the time: the deadline fired at 20s but the request ran
  29.8s. The deadline exists so the container does not work past the Worker's
  patience, and a 50% overshoot meant it was not doing that as tightly as
  `run.py` described.

  **One mechanism for that has since been found and closed**, though it does not
  account for this particular measurement. `asyncio.timeout` wrapped only the
  graph call; the `answered_after_cap` rescue was awaited afterwards with no
  clock of its own, so a turn could spend the full deadline in the loop and then
  begin a fresh model call. `run.py` now runs the whole turn against one
  `_Clock` and the rescue gets what is left of it. The reported incident had
  `usage.model_calls` of 1 and no rescue, so the remaining overshoot is still
  unexplained and this entry stays open.

  This was written as gating step 8, on the reasoning that at step 7 the blast
  radius was one allowlisted account. Steps 8 and 9 both happened anyway, so the
  gate did not hold and the cost is now real: whichever learner draws the slow
  turn loses the tutor's reply, silently, with no second implementation to catch
  it. **The floor still holds** — the word cards are rendered before the tutor is
  called and need no model — so the failure is a missing paragraph, not a broken
  page. That is what makes this a live defect rather than an outage.

  `observability/`'s p95 alert is the standing watch, and §13's own note there is
  honest about its limit: at this traffic one slow turn in fifty will not move
  p95. Counting the individual occurrences still means reading
  `[zh] tutor unavailable` in `wrangler tail`.

  Raising `AGENT_SERVICE_TIMEOUT_MS` is not the lever — §2's 30s Workers ceiling
  leaves no room.

- **Rotating `AGENT_SERVICE_SECRET` without a 401 window.** `run-dev/` leaves
  `secret_versions` empty, so mounts resolve to `latest` — and env-var secrets
  resolve at *instance* start, so mid-rotation the same revision can hold two
  different values while the Worker can only send one. Instances on the old
  version 401 until they recycle. Pinning (`secret_versions`) fixes the
  non-determinism by making rotation a deliberate new revision, but not the
  window itself. Closing that needs the agent to **accept both the current and
  previous secret** during a rotation.

  This was deferred on the grounds that the JS tutor answered every failure by
  taking over. It does not any more (step 9), so a rotation window is now a
  window in which learners get cards and no prose. Still not urgent — the
  learner keeps a correct answer, and rotation is a deliberate act nobody
  performs by accident — but the reason it was cheap has gone, and it should be
  fixed before the next rotation rather than during one.
- **`docs/operations.md`** — worth writing once there is something to operate.
  `docs/secrets.md` is written.

### Explicitly rejected, do not relitigate without new information

- **Leaving D1 or KV.** 61 `.prepare()` call sites across 7 files, 17 of 25
  backend test suites bound to `cloudflare:test`, and a paid database replacing a
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
