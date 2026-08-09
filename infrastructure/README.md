# infrastructure/

Infrastructure as code.

```text
infrastructure/
└── terraform/
    ├── bootstrap/          Terraform state bucket + project-wide APIs
    ├── artifact-registry/  container images for the agent service
    ├── iam/                WIF federation + deploy and runtime identities
    ├── modules/
    │   ├── secrets/        shared: Secret Manager containers + access
    │   └── run/            shared: the Cloud Run service + its IAM
    ├── secrets-dev/        ┐
    ├── secrets-prod/       │ thin roots: a backend prefix, a module call,
    ├── run-dev/            │ and one environment's values
    ├── run-prod/           ┘
    ├── cloudflare/         D1, KV, Pages and two DNS records — all adopted
    ├── github/             branch ruleset + the variables CI reads
    └── observability/      three alerts on the prod agent service
```

`modules/` holds every resource and all the reasoning. The roots hold a state
prefix each, which is what makes an apply in `secrets-dev/` incapable of
touching production — directory names are documentation, the state boundary is
the enforcement.

The bootstrap module is the foundation for the rest of the Terraform
infrastructure.

It is created first and destroyed last.

## Current state

**Every root is written and applied.** `bootstrap/`, `artifact-registry/`,
`iam/`, both environments of `secrets-` and `run-`, `cloudflare/`, `github/`,
`observability/`. Nothing on the plan remains.

`mydeck-agent-prod` serves the Worker warm at `min_instances = 1`;
`mydeck-agent-dev` is idle and kept as the target for local `wrangler dev` and
for images not yet trusted.

`run-dev/` cannot even *plan* until `secrets-dev/` is applied — it reads that
module's state, and a state object that does not exist is a hard error rather
than an empty map.

**All three Terraform lifecycles are done** (§9.1): **create** on GCP, **adopt**
on Cloudflare, **govern/connect** on GitHub. Each is a different discipline
rather than three provider blocks — creating what never existed, taking over
what already ran, and configuring what surrounds both.

`github/` is also what joins them. It reads `iam/` and `artifact-registry/`
outputs through remote state and publishes them as Actions variables, so
`deploy-agent.yml` reads a WIF provider path and an image URI that no human
typed:

```text
iam/ + artifact-registry/  →  github/  →  Actions variables  →  deploy-agent.yml
```

Not automatic: `terraform apply` in `github/` is what refreshes them. Still one
command rather than remembering which file holds a copy.

What remains outside Terraform, and mostly on purpose:

| Resource           | Provisioned by                 | Config lives in         | Terraform?       |
| ------------------ | ------------------------------ | ----------------------- | ---------------- |
| Worker (API)       | `npm run deploy:api`           | `backend/wrangler.toml` | **no** — see below |
| Workers AI binding | `[ai]` block                   | `backend/wrangler.toml` | **no** — part of the script |
| Cloudflare secrets | `wrangler secret put`          | Cloudflare              | **no** — §10     |
| D1 database        | **Terraform** — adopted        | `cloudflare/main.tf`    | done             |
| KV namespace       | **Terraform** — adopted        | `cloudflare/main.tf`    | done             |
| DNS (2 records)    | **Terraform** — `cloudflare/`  | `cloudflare/dns.tf`     | done             |
| Pages site         | **Terraform** — `cloudflare/`  | `cloudflare/main.tf`    | done, see below  |
| Repo governance    | **Terraform** — `github/`      | `github/main.tf`        | done             |

### Cloudflare: what Terraform owns, and what is still dashboard-only

`cloudflare/` adopts five resources. Everything below is now in Git and shows as
a plan diff if it changes — which it did not used to. The Pages build broke on
the repository restructure because `destination_dir` still said `dist` while the
artifact had moved to `frontend/dist`, and nothing in the repo could be checked
against.

| Setting | Value | Owner |
| ------- | ----- | ----- |
| Build command | `npm run build` | **Terraform** |
| Build output directory | `frontend/dist` | **Terraform** |
| Root directory | `""` (repo root — npm workspaces resolve from there) | **Terraform** |
| Build watch paths | all, minus `backend/*` `services/*` `infrastructure/*` `docs/*` `.github/*` | **Terraform** |
| Preview deployments | none — see below | **Terraform** |
| GitHub connection | `kuibinlin/mydeck`, production branch `main` | **Terraform** |
| `VITE_API_URL`, `NODE_VERSION` | — | dashboard |

`deployment_configs` is deliberately undeclared. It is a large nested structure
covering production and preview, and declaring it partially proposes removing
whatever is left out — which is how the `source` block nearly deleted the GitHub
connection on the first plan. The two env vars in it are tracked in state, so
they are recoverable; they are simply not enforced.

**One resource never plans clean**, and it is a provider defect rather than
drift: `cloudflare_pages_project` reports four optional-and-computed attributes
as unknown on every plan (`build_config.build_caching`, the two
`web_analytics_*`, and `source.config.preview_branch_excludes`). Applying writes
nothing. Declaring them is not an option — `preview_branch_excludes = []` failed
an apply outright, because the API normalises empty to null and the provider
cannot reconcile it. `ignore_changes` does not help either; it suppresses
config-versus-state differences, and this is the provider returning unknown.
Reading a plan for that resource means ignoring those four names; anything else
is real.

### DNS: two records out of eighteen

`cloudflare/dns.tf` adopts `mydeckapi.linsnotes.com` and `mydeck.linsnotes.com`
and nothing else. Terraform manages one record per resource, so the other
sixteen are invisible to it — no drift, no plan, no deletion.

That narrowness is the point: an adopted record is a record an edit can delete.
Email (four MX, Brevo and Resend DKIM, SES SPF, DMARC), site verification, the
apex and `www` — all left alone, all unrelated to this app, all working.

`hsk-mcp.linsnotes.com` is left alone too, and that one is worth stating because
the argument for adopting it is tempting. MyDeck depends on it, and from Cloud
Run that hostname *is* the dictionary. But depending on a service is not owning
it — by that reasoning this module would manage SEA-LION's DNS. It is a
standalone service, and adopting it here would mean two Terraform states
believing they own one record the day it gets its own.

The two that are adopted carry `prevent_destroy`, and together they express
something that previously existed only as a code comment: the session cookie is
`SameSite=Lax`, which is viable **only because** the frontend and the API share
the `linsnotes.com` eTLD+1. Moving the API to a different registrable domain
breaks login on iOS Safari, and nothing in the application code would say why.

Preview deployments are off because a preview of this app **cannot log in**, for
two independent reasons:

- `backend/src/config.js` reflects only `linsnotes.com` and
  `mydeck.linsnotes.com` in `Access-Control-Allow-Origin`, so every API call
  from a `*.pages.dev` origin is blocked before it is sent.
- The same `SameSite=Lax` cookie needs the shared eTLD+1. A `pages.dev` origin
  is a different site, so the cookie is never sent.

Loosening `PROD_ORIGINS` to a wildcard would not rescue it either: the same list
constrains login redirect targets, so widening it for previews weakens a
production check. And `ci.yml` already builds the frontend, so a preview was a
second build of the same artifact minus the ability to use it.

## What Terraform owns

Three providers, and each is a different Terraform lifecycle — create, adopt,
govern. `docs/architecture.md` §9.1 is the reasoning; the layout is:

```text
bootstrap/           google       ← first, and destroyed last
    ↓
artifact-registry/   google
    ↓
iam/                 google
    ↓
secrets-<env>/       google       ← one root per environment
    ↓
run-<env>/           google
    ↓
observability/       google

cloudflare/          cloudflare   ← independent of the chain above
github/              github       ← last: reads the others' outputs
```

Each directory is a separate Terraform root module with its own state.

They share the same remote GCS state bucket, but use different state prefixes so
their state remains separate.

**One provider per root module.** Not one root module declaring `google`,
`cloudflare` and `github` together. The point is blast radius: an apply in
`cloudflare/` cannot touch Cloud Run, an apply in `github/` cannot touch DNS.

`cloudflare/` sits outside the dependency chain — it shares nothing with the GCP
modules and can be built at any point. `github/` goes last because it reads the
GCP modules' outputs through `terraform_remote_state` and publishes them as
Actions variables (§9.3).

`github/` is also the one module that **applies locally, not from CI** — its
credential is a repo-admin PAT, and holding that in Actions secrets would put
the credential that governs the repository inside the repository it governs. See
§9.4.

### Central identities, per-environment workloads

Two shapes here, and the difference is deliberate rather than an oversight:

```text
iam/            environments = ["dev", "prod"]     one root, every identity
secrets-dev/    environment  = "dev"               one root per environment
secrets-prod/   environment  = "prod"
run-dev/        …                                  same, per environment
```

Identities are long-lived, applied rarely, and shared by definition — the WIF
pool serves every environment, so splitting `iam/` per environment would mean
duplicating the pool or sharing one across roots. Secrets and services are the
opposite: applied often, and the things you least want a dev-side mistake to
reach. They get separate state, which is what actually makes an apply in
`secrets-dev/` incapable of touching production.

The consequence is an invariant worth stating, because nothing enforces it
structurally:

> **every `secrets-<env>/` and `run-<env>/` environment must already exist in
> `iam/`'s `environments`.**

`secrets-dev/` fails at plan time with a precondition naming the fix if it does
not, rather than with Terraform's generic missing-key error.

## Why bootstrap exists

Terraform needs state to remember which real cloud resources correspond to the
resources declared in `.tf` files.

Normally that state should live remotely:

```text
Terraform
    ↓
GCS state bucket
    ↓
terraform state
```

There is a bootstrap problem, however:

```text
Terraform needs the state bucket
        ↓
but Terraform is also responsible for creating that bucket
```

So `bootstrap/` starts with local state:

```text
bootstrap/
└── terraform.tfstate
```

It creates the GCS bucket, then migrates its own state into that bucket.

See:

```text
terraform/bootstrap/README.md
```

for the exact procedure.

## Creation order

Infrastructure must be created from the foundation upward.

```text
1. Google Cloud project
        ↓
2. bootstrap/
        ↓
3. Artifact Registry
        ↓
4. IAM / Workload Identity Federation
        ↓
5. Secret Manager containers
        ↓
6. Cloud Run dev service
        ↓
7. Observability
        ↓
8. production infrastructure later
```

`cloudflare/` is not in that chain — it depends on nothing above it and can be
built whenever. `github/` comes after the GCP modules it reads outputs from:
`artifact-registry/`, `iam/` and `run-dev/`.

### 1. Google Cloud project

The project itself must already exist and have billing attached.

Terraform is then given the intended project explicitly through:

```hcl
project_id = "..."
```

Do not rely only on whichever project happens to be selected in `gcloud`.

### 2. Bootstrap

Run:

```bash
cd infrastructure/terraform/bootstrap

cp terraform.tfvars.example terraform.tfvars

terraform init
terraform plan
terraform apply
```

Bootstrap creates:

```text
GCS Terraform state bucket
project-wide Google Cloud API enablements
```

The bootstrap state initially remains local.

After the bucket exists, migrate it:

```bash
terraform init -migrate-state
```

From this point onward, Terraform state is stored remotely in GCS.

### 3. Remaining modules

After bootstrap is complete, create the remaining modules in dependency order:

```text
artifact-registry/
iam/
secrets-<env>/    ← one per environment; iam/ must already know that env
run-<env>/          reads both iam/ and secrets-<env>/
observability/      reads run-prod/
github/           ← reads artifact-registry/ and iam/
```

`cloudflare/` has no place in that order — it shares nothing with the GCP
modules and can be built at any point.

Order within a pair matters and across environments does not: `secrets-dev/`
before `run-dev/`, `secrets-prod/` before `run-prod/`, but dev and prod are
independent of each other.

Each module should be reviewed with:

```bash
terraform plan
```

before:

```bash
terraform apply
```

## Destruction order

Destruction happens in the reverse direction.

The most important rule is:

> Do not destroy the Terraform state bucket before the infrastructure whose state
> it contains.

Terraform needs state in order to know what it manages and what needs to be
destroyed.

The normal teardown order is therefore:

```text
github/            holds the only references INTO the other roots' state
        ↓
observability/     reads run-prod/
        ↓
run-<env>/         every environment
        ↓
secrets-<env>/     every environment
        ↓
iam/               prevent_destroy on the pool and provider — see below
        ↓
artifact-registry/
        ↓
bootstrap/ LAST
```

`cloudflare/` can be destroyed at any point, but its D1, KV and DNS records
carry `prevent_destroy` — and removing that guard to destroy D1 deletes every
user. That is the intent.

`github/` goes first among these, because it holds the only references *into*
the GCP modules' state. `cloudflare/` can be destroyed at any point — but note
that its D1 and KV resources carry `prevent_destroy`, and removing that guard to
destroy them deletes live user data. That is the intent.

**`iam/` is not an ordinary module either.** Its workload identity pool and
provider carry `prevent_destroy`, so `terraform destroy` fails until the blocks
are removed deliberately. That guard exists because Google soft-deletes both and
holds their IDs in reserve for 30 days: destroying them does not free
`mydeck-github` or `github-actions`, it makes the module unbuildable as written
until the reservation lapses. If it happens anyway, `undelete` and re-import
rather than wait — the commands are in `iam/workload-identity.tf`.

For each normal module, first review:

```bash
terraform plan -destroy
```

Then destroy:

```bash
terraform destroy
```

Do not proceed to the next layer until the current module has been successfully
removed.

## Destroying bootstrap

Bootstrap is deliberately harder to destroy than the other modules.

The state bucket contains protections such as:

```hcl
force_destroy = false

lifecycle {
  prevent_destroy = true
}
```

This is intentional.

The state bucket is the last resource Terraform should lose.

Only after every other Terraform module has been destroyed should bootstrap be
removed.

At that point:

```text
all application infrastructure gone
        ↓
only bootstrap remains
        ↓
verify / back up Terraform state if needed
        ↓
deliberately remove prevent_destroy
        ↓
empty state bucket when ready
        ↓
destroy bootstrap
```

Because:

```hcl
disable_on_destroy = false
```

is used for project APIs, destroying the bootstrap Terraform resources does not
disable those APIs automatically.

This avoids unexpected project-wide side effects.

## Deleting the whole GCP project

If MyDeck no longer needs Google Cloud at all, the final boundary is the Google
Cloud project itself.

After Terraform-managed resources have been reviewed and removed, the entire
project may be deleted deliberately:

```bash
gcloud projects delete <PROJECT_ID>
```

Project deletion is broader than `terraform destroy`.

It removes resources in the project whether Terraform manages them or not, so it
should be the final action only.

The lifecycle is therefore:

```text
CREATE

GCP project
    ↓
bootstrap
    ↓
application infrastructure


DESTROY

application infrastructure
    ↓
bootstrap
    ↓
optional GCP project deletion
```

## Terraform ownership decisions

Three infrastructure rules apply throughout the repository.

### Remote state

A versioned GCS bucket created by `bootstrap/` stores Terraform state.

Bootstrap temporarily starts with local state because it has to create the
bucket before it can use it.

See:

```text
terraform/bootstrap/README.md
```

### Terraform vs Wrangler

Terraform owns infrastructure.

Wrangler owns the Cloudflare Worker application deployment.

Do not have Terraform and Wrangler both manage the same resource.

This is not a preference — the Cloudflare API offers no seam. In provider v5,
`cloudflare_workers_script` carries `content`, `bindings`, `compatibility_date`,
`observability` and `limits` as a **single resource**, which is the same set
`backend/wrangler.toml` declares and `wrangler deploy` uploads. Whichever tool
uploads the script owns its bindings.

So the split is:

```text
Terraform   the D1 database and KV namespace exist   ← containers
Wrangler    the Worker is bound to them              ← bindings
```

The `database_id` and KV `id` are copied into `backend/wrangler.toml` by hand.
That copy is the cost of the split, and it is cheaper than two tools fighting
over one resource.

Routes are the same choice: `[[routes]]` in `wrangler.toml` **or**
`cloudflare_workers_route`, never both.

### The same collision on Cloud Run

`run-dev/` faces this one layer up and resolves it identically. Terraform
declares `google_cloud_run_v2_service` including the image, so every CI deploy
of a new SHA would put Terraform permanently out of date — and the next apply
would roll the service back to whatever tag is written in the `.tf` file.

```hcl
lifecycle {
  ignore_changes = [template[0].containers[0].image, client, client_version]
}
```

Terraform owns the service **shape** — CPU, memory, concurrency, ingress,
timeout, scaling, runtime identity, env vars, secret mounts. CI owns the
**artifact**, via `gcloud run deploy --image ...:$SHA`. `client` and
`client_version` are ignored for the same reason: `gcloud` stamps them on every
deploy, and which tool last touched the service is not something Terraform has
an opinion about.

The consequence is that `var.bootstrap_image` is read only at create and never
again, which is why it stays `gcr.io/cloudrun/hello` rather than a real SHA —
a real-looking tag would be permanently stale and would read as though it were
what is serving. `terraform output -raw running_image_cmd` prints the command
that reports the truth.

D1 and KV already exist and hold live data, so they are adopted with
`terraform import`, never re-created:

```bash
terraform import cloudflare_d1_database.main '<account_id>/<database_id>'
```

Both carry `lifecycle { prevent_destroy = true }` — a replacement drops user
data, which makes them higher-stakes than anything in `bootstrap/`.

See `docs/architecture.md` §9.

### Secrets stay out of Terraform where possible

Terraform state can contain sensitive resource attributes.

Secret Manager resources may be created by Terraform, but secret values are set
out of band rather than passed through Terraform variables.

For example:

```bash
echo -n "$VALUE" | \
  gcloud secrets versions add <SECRET_NAME> --data-file=-
```

The Cloudflare equivalent is:

```bash
wrangler secret put
```

`secrets-dev/` is built on that rule: it creates containers and grants read access,
and contains no `google_secret_manager_secret_version` resource at all. There is
an ordering consequence Terraform cannot express —

```text
1. terraform apply   in secrets-dev/ creates empty containers
2. gcloud secrets versions add       by hand, per secret
3. terraform apply   in run-dev/     mounts them
```

— because a secret with no version cannot be mounted, so skipping step 2 fails
the Cloud Run deploy one module later than the omission. `terraform output
set_values` prints the exact commands and `terraform output unset_check` prints
one command that counts versions per secret. Run the second before touching
`run-dev/`.

`cloudflare_workers_secret` was removed in provider v5, so this one enforces
itself.

The GitHub equivalent is the same rule stated backwards: `github/` manages
Actions **variables**, never Actions secrets. `github_actions_secret` requires
the value, so declaring one writes it into the state bucket in plaintext.

Terraform itself needs credentials, and those are not the same as the ones CI
uses:

| Credential                 | Held by        | Scope                                                        |
| -------------------------- | -------------- | ------------------------------------------------------------ |
| Cloudflare deploy token    | GitHub Actions | Workers Scripts:Edit                                          |
| Cloudflare Terraform token | your machine   | Zone:DNS:Edit, D1:Edit, Workers KV Storage:Edit, Pages:Edit    |
| GitHub PAT                 | your machine   | repo admin — for `github/` only                               |
| Google                     | **nothing stored** | ADC locally, Workload Identity Federation in CI          |

Two Cloudflare tokens rather than one, because reusing the Terraform token in CI
would hand the deploy workflow the ability to rewrite DNS.

See `docs/architecture.md` §10.

## GCP direction

`services/agent-service/` is a Python container running the Chinese tutor's
agent loop.

Cloud Run is the target runtime for that service.

The staged path is:

```text
local container
    ↓
Artifact Registry
    ↓
Cloud Run dev
    ↓
measure cold/warm latency
    ↓
production rollout
```

The local latency measurements did not include Cloud Run cold start, the
Cloudflare → Google network hop, or production authentication, so this section
used to say the dev deployment should be measured before deciding whether any
synchronous request flow needs to become asynchronous.

**Measured 2026-08-09**, from `[agent:shadow]` `remoteMs` — wall clock at the
Worker, so it includes every one of those three:

```text
cold    23,626 ms      create_activity, 2 model calls
warm     5,800 ms      create_activity, 2 model calls   ← same work
warm     2,058 ms      no tools, 1 model call
warm     1,776 ms      no tools, 1 model call
```

Two conclusions.

**Synchronous is fine. Keep it.** Warm turns are 1.8–5.8s, comfortably inside the
Worker's 25s budget. Nothing here justifies the complexity of an asynchronous
flow.

**Cold start is the whole problem, and it is ~17.8s.** The two `create_activity`
turns did identical work; the difference is Python starting and LangChain's
import graph loading. That left **1.4s of margin** against
`AGENT_SERVICE_TIMEOUT_MS = 25000` — and a Worker timeout is rethrown rather than
retried, so `routes/zh.js` degrades to the cards and the learner loses the prose
entirely.

**`AGENT_DEADLINE_S` does not protect against this.** Cloud Run holds the request
while the container boots, so the agent's clock starts *after* the cold start is
already paid. That turn reported `stoppedBy: "answered"` — from the agent's own
perspective it was a 5s turn. The timeout chain in `run-dev/variables.tf` bounds
agent work and says nothing about container boot.

So the fix is a warm instance, not a bigger timeout — there is nowhere to grow,
since the free Workers plan caps a request at 30s wall clock (architecture.md §2)
and 25s is already most of it. `run-dev/` keeps `min_instances = 0`; `run-prod/`
should set `1`. Note that this removes *scale-to-zero* cold starts only: with
`concurrency = 10`, the 11th simultaneous request still starts a second container
and pays the boot.

Kubernetes is not currently justified for this workload.

One independently deployed container does not require a cluster; Cloud Run is
the simpler operational target.