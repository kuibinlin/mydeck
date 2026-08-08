# infrastructure/

Infrastructure as code.

```text
infrastructure/
└── terraform/
    ├── bootstrap/          Terraform state bucket + project-wide APIs
    └── artifact-registry/  container images for the agent service
```

The bootstrap module is the foundation for the rest of the Terraform
infrastructure.

It is created first and destroyed last.

## Current state

`bootstrap/` and `artifact-registry/` are written, `fmt`-clean and
`validate`-clean.

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
secrets/             google
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
secrets/
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
secrets/
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

The local latency measurements do not include:

```text
Cloud Run cold start
Cloudflare → Google network hop
production authentication
```

so dev deployment should be measured before deciding whether any synchronous
request flow needs to become asynchronous.

Kubernetes is not currently justified for this workload.

One independently deployed container does not require a cluster; Cloud Run is
the simpler operational target.