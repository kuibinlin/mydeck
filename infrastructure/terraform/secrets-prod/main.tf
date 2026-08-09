# Secret Manager containers for the PRODUCTION agent service.
#
# Identical code to secrets-dev/ — same module, different environment and a
# different state prefix. That is the point of the extraction: a rule added to
# ../modules/secrets applies to both, and cannot be silently absent from
# production because someone edited one copy.
#
# What must NOT be identical is the values. AGENT_SERVICE_SECRET here is
# generated fresh, never copied from dev. Sharing it would make the two
# environments one trust domain and undo the separate runtime identities that
# iam/ creates precisely to keep them apart — a value leaked from the
# environment you experiment in would be the value production is trusting.
#
# docs/secrets.md has the generate-once-set-twice procedure. Run it twice here:
# once for prod's Secret Manager copy, once for the Worker's, and never reuse
# dev's value for either.

module "secrets" {
  source = "../modules/secrets"

  project_id     = var.project_id
  region         = var.region
  environment    = var.environment
  enable_tracing = var.enable_tracing
}
