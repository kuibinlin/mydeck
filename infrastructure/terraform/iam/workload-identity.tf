# ─────────────────────────────────────────────────────────────────────────────
# Workload Identity Federation for GitHub Actions
# ─────────────────────────────────────────────────────────────────────────────
#
# This allows GitHub Actions to authenticate to Google Cloud without creating
# or storing a long-lived Google service account JSON key.
#
# The authentication flow is:
#
#   GitHub Actions
#       ↓
#   GitHub issues a short-lived OIDC identity token
#       ↓
#   this Workload Identity Provider verifies the token and its claims
#       ↓
#   Google IAM allows the trusted GitHub identity to impersonate the deploy SA
#       ↓
#   Google issues short-lived credentials for the deploy SA
#
# No permanent Google service account key needs to be stored in GitHub.
#
# docs/architecture.md §9.3 and §10.
#
# ─────────────────────────────────────────────────────────────────────────────
# WARNING — do not casually destroy this module.
# ─────────────────────────────────────────────────────────────────────────────
#
# Google soft-deletes Workload Identity Pools and Providers.
#
# A deleted pool/provider can be restored for up to 30 days. During that
# period, its ID remains reserved, so Terraform cannot simply create a new
# resource with the same ID.
#
# Therefore:
#
#   terraform destroy
#   terraform apply
#
# may fail because "mydeck-github" and/or "github-actions" are still reserved.
#
# Recovery is normally to undelete the existing resources and import them back
# into Terraform state rather than waiting for permanent deletion.
#
# Example pool recovery:
#
#   gcloud iam workload-identity-pools undelete mydeck-github \
#     --location=global
#
# Provider recovery:
#
#   gcloud iam workload-identity-pools providers undelete github-actions \
#     --workload-identity-pool=mydeck-github \
#     --location=global
#
# After recovery, import the resources back into Terraform state if Terraform
# removed them during destroy.
#
# ─────────────────────────────────────────────────────────────────────────────

locals {
  # GitHub places the repository in the token as "owner/repository".
  repository = "${var.github_owner}/${var.github_repository}"

  # Combine repository + ref into one identity attribute.
  #
  # Example:
  #
  #   kuibinlin/mydeck@refs/heads/main
  #
  # bindings.tf can then grant deploy permission to this exact combination
  # rather than matching "main" independently of the repository.
  repository_ref = "${local.repository}@${var.deploy_ref}"
}


resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "mydeck-github"

  display_name = "MyDeck GitHub Actions"
  description  = "Federated identity for MyDeck CI/CD. No service account keys are used."

  # Require a deliberate configuration change before this pool can be destroyed
  # or replaced, for the soft-delete reason described above: losing it reserves
  # the ID "mydeck-github" for 30 days, during which this module cannot be
  # rebuilt as written.
  #
  # A lifecycle block rather than deletion_policy = "PREVENT". deletion_policy
  # guards only an explicit delete; prevent_destroy also blocks a REPLACEMENT,
  # and a change that forces destroy-and-recreate burns the ID exactly as
  # thoroughly as a destroy does.
  #
  # Same treatment, and the same reasoning, as the state bucket in bootstrap/.
  # Tearing down iam/ therefore requires removing this block first — see the
  # destruction order in infrastructure/README.md.
  lifecycle {
    prevent_destroy = true
  }
}


resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"

  display_name = "GitHub Actions OIDC"

  # Map selected claims from GitHub's OIDC token into attributes that Google
  # IAM policies can use.
  #
  # A claim that is not mapped here cannot be referenced later through these
  # workload identity attributes, so keep this deliberately minimal.
  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"              = "assertion.ref"

    # Repository and ref are deliberately combined.
    #
    # Matching attribute.ref alone would only say:
    #
    #   refs/heads/main
    #
    # Every repository can have a main branch.
    #
    # Combining them produces:
    #
    #   kuibinlin/mydeck@refs/heads/main
    #
    # which can be matched safely in bindings.tf.
    "attribute.repository_ref" = "assertion.repository + '@' + assertion.ref"
  }


  # ───────────────────────────────────────────────────────────────────────────
  # WHO MAY FEDERATE THROUGH THIS PROVIDER?
  # ───────────────────────────────────────────────────────────────────────────
  #
  # GitHub's OIDC issuer serves GitHub Actions globally, so trusting the issuer
  # alone is not enough.
  #
  # Restrict federation to this exact repository.
  #
  # Note that this deliberately does NOT restrict the Git ref here.
  #
  # Any branch in this repository may obtain a federated identity, allowing
  # future read-only workflows such as pull-request terraform plan jobs.
  #
  # What a federated identity is allowed to DO is restricted separately in
  # bindings.tf. The deploy SA binding should match local.repository_ref so only
  # the configured deploy_ref can deploy.
  attribute_condition = <<-EOT
    assertion.repository_owner == "${var.github_owner}" &&
    assertion.repository == "${local.repository}"
  EOT

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  # Same protection as the pool, and needed separately: provider IDs are
  # soft-deleted and reserved for 30 days on their own. Destroying only the
  # provider leaves the pool intact and CI unable to authenticate, with no way
  # to recreate "github-actions" until the reservation lapses.
  lifecycle {
    prevent_destroy = true
  }
}