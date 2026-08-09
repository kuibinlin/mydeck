# Secret Manager containers for the dev agent service.
#
# This root holds a backend, a provider and one environment's values. Every
# resource, and all the reasoning about why they are shaped the way they are,
# lives in ../modules/secrets.
#
# The split exists because secrets-prod/ is the same code with one different
# value, and ~350 lines of commented Terraform copied into a second directory
# drifts. A shared module means a rule added here — a new required secret, a
# changed replication policy — cannot be silently absent from production.
#
# What stays per-root: the backend prefix, so the two states are separate and an
# apply here has no production resources in scope to change.

module "secrets" {
  source = "../modules/secrets"

  project_id     = var.project_id
  region         = var.region
  environment    = var.environment
  enable_tracing = var.enable_tracing
}
