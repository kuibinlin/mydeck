# ─────────────────────────────────────────────────────────────────────────────
# IAM module outputs
# ─────────────────────────────────────────────────────────────────────────────
#
# These outputs expose the non-secret identifiers that downstream modules and
# CI/CD need.
#
# None of these values are credentials.
#
# They describe:
#
#   - which Workload Identity Provider GitHub Actions should use
#   - which Google service account GitHub may impersonate
#   - which service account Cloud Run should run as
#   - exactly which GitHub repository/ref is trusted for deployment
#
# These values are intentionally surfaced so downstream configuration does not
# need to reconstruct long Google resource names by hand.
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# Workload Identity Provider
# ─────────────────────────────────────────────────────────────────────────────
#
# Full Google resource name of the GitHub OIDC provider.
#
# GitHub Actions will eventually pass this value to:
#
#   google-github-actions/auth
#
# The value is long and provider-generated, so it should flow from Terraform
# state into GitHub Actions variables rather than being copied manually.
#
# Intended future flow:
#
#   iam/ output
#       ↓
#   github/ Terraform
#       ↓
#   GitHub Actions variable
#       ↓
#   google-github-actions/auth
#
# This is an identifier, not a secret.
# ─────────────────────────────────────────────────────────────────────────────

output "workload_identity_provider" {
  description = "Full Workload Identity Provider resource name used by google-github-actions/auth and published to GitHub Actions as a non-secret variable."

  value = google_iam_workload_identity_pool_provider.github.name
}


# ─────────────────────────────────────────────────────────────────────────────
# Deploy service account
# ─────────────────────────────────────────────────────────────────────────────
#
# Email address of the Google service account used by CI/CD.
#
# GitHub Actions does not possess a permanent key for this identity.
# Instead, an approved GitHub workflow authenticates through WIF and receives
# short-lived credentials that allow it to impersonate this service account.
#
# Intended use:
#
#   GitHub Actions
#       ↓
#   WIF
#       ↓
#   this deploy service account
#       ↓
#   push image / deploy Cloud Run revision
#
# The email address is an identifier, not a secret.
# ─────────────────────────────────────────────────────────────────────────────

output "deploy_service_account" {
  description = "Email of the CI/CD service account impersonated by GitHub Actions through Workload Identity Federation."

  value = google_service_account.deploy.email
}


# ─────────────────────────────────────────────────────────────────────────────
# Runtime service accounts
# ─────────────────────────────────────────────────────────────────────────────
#
# Keyed by environment, because there is one runtime identity per Cloud Run
# service rather than one shared across them:
#
#   {
#     "dev"  = "mydeck-agent-dev-runtime@mydeck-linsnotes.iam.gserviceaccount.com"
#     "prod" = "mydeck-agent-prod-runtime@..."     # once "prod" is in tfvars
#   }
#
# This output is consumed by other infrastructure modules:
#
#   run-dev/
#     → attaches runtime_service_accounts["dev"] to the Cloud Run service
#
#   secrets/
#     → grants that environment's account access to that environment's secrets
#
# A map rather than a string on purpose. A downstream module has to name the
# environment it means, which is what stops a production secret from being
# granted to a development identity by accident.
#
# The email addresses are identifiers, not secrets.
# ─────────────────────────────────────────────────────────────────────────────

output "runtime_service_accounts" {
  description = "Runtime service account emails keyed by environment. Downstream modules index by environment rather than assuming a single identity."

  value = { for env, sa in google_service_account.runtime : env => sa.email }
}


# ─────────────────────────────────────────────────────────────────────────────
# Deployment trust summary
# ─────────────────────────────────────────────────────────────────────────────
#
# This output makes the most security-sensitive relationship in this module
# visible in one place.
#
# The actual enforcement is split across:
#
#   workload-identity.tf
#     → trusts the configured GitHub repository
#
#   bindings.tf
#     → restricts deploy-SA impersonation to repository + deploy_ref
#
# Rather than reconstructing those two pieces mentally, this output shows the
# final intended deployment identity directly.
#
# Example:
#
#   kuibinlin/mydeck@refs/heads/main may impersonate
#   mydeck-deploy@mydeck-linsnotes.iam.gserviceaccount.com
#
# This is informational only. The IAM resources remain the enforcement layer.
# ─────────────────────────────────────────────────────────────────────────────

output "deploy_trust" {
  description = "Human-readable summary of the GitHub repository/ref allowed to impersonate the deploy service account."

  value = "${local.repository_ref} may impersonate ${google_service_account.deploy.email}"
}


# ─────────────────────────────────────────────────────────────────────────────
# Service account key policy
# ─────────────────────────────────────────────────────────────────────────────
#
# This module deliberately creates NO user-managed service account keys.
#
# Authentication is intended to remain keyless:
#
#   GitHub Actions
#     → Workload Identity Federation
#
#   Cloud Run
#     → attached runtime service account
#
# Important:
#
# Terraform can only state what this module creates.
#
# It cannot prove that nobody later created a service account key manually in
# the Google Cloud Console, with gcloud, or from another Terraform state.
#
# To audit for user-managed keys, check each service account explicitly with
# gcloud, for example:
#
#   gcloud iam service-accounts keys list \
#     --iam-account=mydeck-deploy@mydeck-linsnotes.iam.gserviceaccount.com
#
#   gcloud iam service-accounts keys list \
#     --iam-account=mydeck-agent-dev-runtime@mydeck-linsnotes.iam.gserviceaccount.com
#
# One runtime account exists per environment, so repeat the second command for
# each entry in `terraform output runtime_service_accounts`.
#
# User-managed keys should not exist for these accounts.
# ─────────────────────────────────────────────────────────────────────────────

output "service_account_key_policy" {
  description = "Reminder that this module uses keyless authentication and does not create user-managed service account keys."

  value = "Terraform creates no user-managed service account keys. GitHub uses WIF and Cloud Run uses an attached runtime identity. Any user-managed key found on these accounts was created out of band and should be investigated."
}