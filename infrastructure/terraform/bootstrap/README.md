# bootstrap

Creates the Terraform state bucket and enables the project's APIs. Run once,
before any other module exists.

**Nothing else in this repository can be applied until this has been.**

## Before you run it

Two checks, and the second is the one that matters.

```bash
gcloud auth login                 # tokens expire; this is interactive
gcloud config get-value project   # ← read this carefully
gcloud auth list                  # ← and this
```

**Do not apply this into an employer's project.** A work account with a work
project selected is the normal state of a work laptop, and Terraform will build
a personal side project inside it without complaint. `variables.tf` validates
that `project_id` starts with `mydeck` for exactly this reason — the validation
is a tripwire, not a naming convention.

If the project does not exist yet:

```bash
gcloud projects create mydeck-linsnotes --name="MyDeck"
gcloud billing projects link mydeck-linsnotes --billing-account=<ACCOUNT_ID>
gcloud config set project mydeck-linsnotes
```

## Run it

```bash
cp terraform.tfvars.example terraform.tfvars   # edit if the bucket name is taken
terraform init
terraform plan       # read it — this is the only module that runs unlocked
terraform apply
```

`terraform plan` should propose exactly one bucket and eleven API enablements.
Anything else means the wrong project is selected.

## Then move its own state into the bucket

This module starts with **local** state, because a `backend "gcs"` block needs a
bucket that exists and this is what creates it. Once it does, close the loop:

1. Uncomment the `backend "gcs"` block in `versions.tf`
2. `terraform init -migrate-state`
3. Confirm when prompted; delete the leftover local `terraform.tfstate`

Skipping this leaves the state for the bucket itself on one laptop — which is
the failure the bucket exists to prevent, one level up.

## What the guards are for

| | |
|---|---|
| `versioning` | a bad apply, a bad merge, or `state rm` in the wrong directory are recoverable while the previous generation exists |
| `force_destroy = false` | `terraform destroy` cannot empty the bucket to make its own deletion succeed |
| `prevent_destroy = true` | and cannot replace it either, without a deliberate edit |
| `public_access_prevention` | state is plaintext resource attributes |

State locking needs nothing extra — GCS does it natively with object generation
preconditions. There is no lock table to create; the DynamoDB step from the AWS
version of this pattern has no equivalent.

## Secrets

Terraform state records resource attributes in plaintext, so **a secret passed
through a Terraform variable becomes a secret stored in this bucket.** Secret
Manager holds the *containers*; the values are set out of band:

```bash
echo -n "$VALUE" | gcloud secrets versions add <name> --data-file=-
```

Same rule as `wrangler secret put` on the Cloudflare side. See
`docs/architecture.md` §10.

## Next

Bootstrap is the only module with the chicken-and-egg problem. Every later root
module uses the bucket from its first `init`, so none of them repeat the
`-migrate-state` step — they start with:

```hcl
terraform {
  backend "gcs" {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "<this module's directory name>"
  }
}
```

A `backend` block cannot read variables, so the bucket name is written out rather
than derived from `project_id` the way `state.tf` derives it. One prefix per root
module, named for its directory, keeps their state separate inside the one bucket.

The order after this one is in `docs/architecture.md` §11.
