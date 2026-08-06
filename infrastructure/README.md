# infrastructure/

Infrastructure as code. **Empty on purpose** — nothing here is wired up yet.

Today the whole stack is provisioned by hand through Wrangler and the Cloudflare
dashboard:

| Resource | Provisioned by | Config lives in |
|---|---|---|
| Worker (API) | `npm run deploy:api` | `backend/wrangler.toml` |
| D1 database | `wrangler d1 create` | `backend/wrangler.toml` |
| KV namespace | `wrangler kv namespace create` | `backend/wrangler.toml` |
| Workers AI binding | `[ai]` block | `backend/wrangler.toml` |
| Pages site | Cloudflare dashboard | dashboard only |
| Secrets | `wrangler secret put` | Cloudflare (encrypted) |

## What goes here

```
infrastructure/
├── terraform/          root module(s)
│   ├── environments/   per-environment tfvars and backends (dev, prod)
│   └── modules/        reusable pieces (artifact registry, cluster, dns)
└── README.md
```

## Before writing the first .tf file

Three decisions worth making deliberately, because each is expensive to reverse:

1. **Remote state.** Terraform's default is a local `terraform.tfstate`, which
   `.gitignore` deliberately excludes — so with the default, state exists only on
   whichever laptop ran `apply` last, and CI cannot apply at all. A GCS bucket
   with versioning enabled, configured in a `backend "gcs"` block, is the usual
   answer. Decide this before the first `apply`, not after.

2. **What Terraform owns vs. what Wrangler owns.** These overlap and will fight.
   The Cloudflare Terraform provider can manage Workers, D1 and KV — but
   `wrangler deploy` also writes the Worker script, and whichever ran last wins.
   The common split is: Terraform owns resources that are *created once* (the D1
   database, the KV namespace, DNS, the Pages project) and Wrangler owns the
   *deploy* (the script itself). Pick one owner per resource and write it down.

3. **Secrets stay out of state.** Terraform state records resource attributes in
   plaintext, so a secret passed through a Terraform variable is a secret stored
   in the state bucket. Keep `wrangler secret put` (and later Secret Manager) as
   the path for `RESEND_API_KEY`, the GitHub OAuth pair and `AI_API_KEY`.

## On the GCP direction

Artifact Registry, containers and Kubernetes solve a problem this app does not
have yet: Workers has no image to store and no container to schedule, and the
frontend is a static bundle. If the goal is to *learn* that stack, the honest
first target is a new service that genuinely needs a container — not a
containerised rewrite of the Worker, which would trade a free edge runtime for a
billed always-on node.

A staged path that keeps the app working throughout:

1. **Terraform the Cloudflare resources you already have.** Import D1, KV and the
   Pages project into state. No behaviour changes, and it is the cheapest way to
   learn the workflow against something real.
2. **Terraform a GCP project + Artifact Registry.** Still nothing deployed to it.
3. **Add the first containerised service** — a job that does not fit Workers'
   limits (a long batch import, image processing, a scheduled ETL). Build it in
   CI, push to Artifact Registry, run it on Cloud Run.
4. **Only then consider GKE**, and only if several services and their networking
   justify a cluster's standing cost and operational surface.
