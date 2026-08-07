# infrastructure/

Infrastructure as code.

```text
infrastructure/
└── terraform/
    └── bootstrap/      Terraform state bucket + project-wide APIs
```

The bootstrap module is the foundation for the rest of the Terraform
infrastructure.

It is created first and destroyed last.

## Current state

`bootstrap/` is written, `fmt`-clean and `validate`-clean.

The remaining infrastructure is still managed outside Terraform:

| Resource           | Provisioned by                 | Config lives in         |
| ------------------ | ------------------------------ | ----------------------- |
| Worker (API)       | `npm run deploy:api`           | `backend/wrangler.toml` |
| D1 database        | `wrangler d1 create`           | `backend/wrangler.toml` |
| KV namespace       | `wrangler kv namespace create` | `backend/wrangler.toml` |
| Workers AI binding | `[ai]` block                   | `backend/wrangler.toml` |
| Pages site         | Cloudflare dashboard           | dashboard only          |
| Cloudflare secrets | `wrangler secret put`          | Cloudflare              |

The GCP infrastructure will be moved into Terraform incrementally.

## What Terraform owns

The intended GCP structure is:

```text
bootstrap/
    ↓
artifact-registry/
    ↓
iam/
    ↓
secrets/
    ↓
run-dev/
    ↓
observability/
```

Each directory is a separate Terraform root module with its own state.

They share the same remote GCS state bucket, but use different state prefixes so
their state remains separate.

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
```

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