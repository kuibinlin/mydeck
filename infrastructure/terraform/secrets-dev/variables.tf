variable "project_id" {
  description = "Google Cloud project ID that owns the MyDeck infrastructure."
  type        = string

  # Repeated from bootstrap rather than inherited, matching every other root
  # module here: each root has its own tfvars, and a typo could target the
  # wrong Google Cloud project.
  validation {
    condition     = can(regex("^mydeck($|-)", var.project_id))
    error_message = "project_id must be 'mydeck' or start with 'mydeck-'. Relax this validation deliberately if a different project naming scheme is intended."
  }
}

variable "region" {
  description = "Google Cloud region used for Secret Manager replication. Should match the region of the corresponding Cloud Run service."
  type        = string
  default     = "asia-southeast1"
}


# ─────────────────────────────────────────────────────────────────────────────
# Environment owned by this Terraform root
# ─────────────────────────────────────────────────────────────────────────────
#
# Each secrets Terraform root owns exactly one environment:
#
#   secrets-dev/
#     environment = "dev"
#
#   secrets-prod/
#     environment = "prod"
#
# This is intentional.
#
# Keeping dev and prod in separate Terraform states means:
#
#   cd secrets-dev
#   terraform apply
#
# cannot modify production secrets because production resources do not exist in
# the secrets-dev state.
#
# This variable therefore answers:
#
#   "Which environment does THIS Terraform root own?"
#
# It does NOT mean:
#
#   "Which environment am I deploying to right now?"
#
# The corresponding runtime service account must already exist in iam/, for
# example:
#
#   dev  → mydeck-agent-dev-runtime
#   prod → mydeck-agent-prod-runtime
# ─────────────────────────────────────────────────────────────────────────────

variable "environment" {
  description = "Single environment owned by this Terraform root, for example dev or prod."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,8}$", var.environment))
    error_message = "environment must start with a lowercase letter, contain only lowercase letters, digits or hyphens, and be at most 9 characters."
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Optional Langfuse tracing secrets
# ─────────────────────────────────────────────────────────────────────────────
#
# When false, this module creates only the secrets required for the agent:
#
#   AGENT_SERVICE_SECRET
#   AI_API_KEY
#
# When true, it additionally creates:
#
#   LANGFUSE_PUBLIC_KEY
#   LANGFUSE_SECRET_KEY
#
# The flag controls only whether the Secret Manager CONTAINERS exist.
#
# Terraform still does not create secret versions or set secret values.
#
# A Secret Manager secret with no enabled version cannot be used successfully
# by the Cloud Run service. Therefore, enable tracing only when you are ready to
# add both Langfuse values out of band before applying the matching run-<env>/
# module.
#
# app/tracing.py enables tracing only when both Langfuse values are available,
# so the pair is managed together.
# ─────────────────────────────────────────────────────────────────────────────

variable "enable_tracing" {
  description = "Whether to create the Langfuse credential containers for this environment."
  type        = bool
  default     = false
}