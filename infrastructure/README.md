# infrastructure/

Infrastructure as code.

```text
infrastructure/
└── terraform/
    ├── bootstrap/          Terraform state bucket + project-wide APIs
    ├── artifact-registry/  container images for the agent service
    ├── iam/                WIF federation + deploy and runtime identities
    ├── secrets-dev/        Secret Manager containers for dev
    └── run-dev/            the agent service on Cloud Run, dev
```

The bootstrap module is the foundation for the rest of the Terraform
infrastructure.

It is created first and destroyed last.

## Current state

**Every module written so far is applied** — `bootstrap/`, `artifact-registry/`,
`iam/`, `secrets-dev/`, `run-dev/`. `mydeck-agent-dev` serves on Cloud Run, its
secrets are populated, and CI's permission chain has been exercised for real by
a `gcloud run deploy`.

Not written yet: `observability/`, `cloudflare/`, `github/`, and any `-prod`
root.

`run-dev/` cannot even *plan* until `secrets-dev/` is applied — it reads that
module's state, and a state object that does not exist is a hard error rather
than an empty map.

The remaining infrastructure is still managed outside Terraform:

| Resource           | Provisioned by                 | Config lives in         | Terraform later? |
| ------------------ | ------------------------------ | ----------------------- | ---------------- |
| Worker (API)       | `npm run deploy:api`           | `backend/wrangler.toml` | **no** — see below |
| Workers AI binding | `[ai]` block                   | `backend/wrangler.toml` | **no** — part of the script |
| Cloudflare secrets | `wrangler secret put`          | Cloudflare              | **no** — §10     |
| D1 database        | `wrangler d1 create`           | `backend/wrangler.toml` | yes, by import   |
| KV namespace       | `wrangler kv namespace create` | `backend/wrangler.toml` | yes, by import   |
| DNS / zone         | Cloudflare dashboard           | dashboard only          | yes              |
| Pages site         | Cloudflare dashboard           | dashboard only          | yes              |
| Repo governance    | GitHub dashboard               | dashboard only          | yes              |

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
secrets-dev/         google       ← one root per environment
    ↓
run-dev/             google
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
secrets-dev/
run-dev/
observability/
github/           ← reads the above through terraform_remote_state
```

`cloudflare/` has no place in that order — build it at any point.

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
production resources, if any
        ↓
github/
        ↓
observability/
        ↓
run-dev/
        ↓
secrets-dev/
        ↓
iam/
        ↓
artifact-registry/
        ↓
bootstrap/ LAST
```

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