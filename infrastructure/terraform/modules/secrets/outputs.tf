# ─────────────────────────────────────────────────────────────────────────────
# Secret Manager outputs
# ─────────────────────────────────────────────────────────────────────────────
#
# These outputs expose secret NAMES and configuration metadata only.
#
# They never expose secret VALUES.
#
# Secret values are deliberately populated out of band and are never passed
# through Terraform, because values managed or returned by Terraform can be
# persisted in Terraform state.
#
# This root owns exactly one environment, so downstream modules already know
# whether these are dev or prod secrets from the state they are reading.
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# Secret IDs
# ─────────────────────────────────────────────────────────────────────────────
#
# Secret Manager resource IDs keyed by logical secret type.
#
# Example for secrets-dev/:
#
#   {
#     service-secret = "mydeck-agent-dev-service-secret"
#     ai-api-key     = "mydeck-agent-dev-ai-api-key"
#   }
#
# The matching run-<env>/ module can use these IDs when configuring Cloud Run
# secret environment variables.
# ─────────────────────────────────────────────────────────────────────────────

output "secret_ids" {
  description = "Secret Manager secret IDs keyed by logical secret type. Secret values are populated out of band."

  value = {
    for k, s in google_secret_manager_secret.agent :
    k => s.secret_id
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Container environment-variable mapping
# ─────────────────────────────────────────────────────────────────────────────
#
# Maps each logical secret type to the environment variable expected by the
# Python application.
#
# Example:
#
#   {
#     service-secret = "AGENT_SERVICE_SECRET"
#     ai-api-key     = "AI_API_KEY"
#   }
#
# run-<env>/ needs both:
#
#   secret_ids["ai-api-key"]
#       → which Secret Manager secret to read
#
#   secret_env_vars["ai-api-key"]
#       → which environment variable to expose it as
#
# Keeping both mappings in this module avoids retyping the relationship in the
# Cloud Run module.
# ─────────────────────────────────────────────────────────────────────────────

output "secret_env_vars" {
  description = "Container environment variable associated with each logical secret type."

  value = {
    for k, s in local.secrets :
    k => s.env_var
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Commands for setting secret values
# ─────────────────────────────────────────────────────────────────────────────
#
# Every Secret Manager resource created by this module initially has NO secret
# version.
#
# Terraform intentionally does not create:
#
#   google_secret_manager_secret_version
#
# so an out-of-band step is required before the matching Cloud Run service is
# deployed.
#
# This output generates the exact gcloud commands using the Secret Manager IDs
# Terraform actually created.
#
# Important:
#
#   printf '<NAME>: '
#     → NAMES what the next prompt is waiting for. Without it, running these as
#       a block gives consecutive blank cursors, so entering them out of order
#       writes the AI key into the service secret. Both commands succeed; the
#       mismatch surfaces at the first model call.
#
#     The prompt is a separate printf rather than read's own prompt flag,
#     because those flags are NOT portable:
#
#       bash    read -rsp 'NAME: ' NAME
#       zsh     read -rs "NAME?NAME: "        (-p means coprocess in zsh)
#
#     Emitting either one breaks in the other shell — and this repository's
#     default shell is zsh while most published runbooks are bash. `printf`
#     plus a bare `read` behaves identically in both.
#
#   IFS= read -rs <NAME>
#     → -s does not echo, so the value stays off screen and out of history
#     → -r takes the value raw, so a backslash in a key is not an escape
#     → IFS= keeps leading and trailing whitespace rather than stripping it
#
#   printf '%s'
#     → writes the value without appending a newline
#
# A trailing newline becomes part of the stored secret and can cause
# authentication failures that are difficult to diagnose.
#
# The commands themselves contain only secret names and shell variable names.
# They do NOT contain secret values.
# ─────────────────────────────────────────────────────────────────────────────

output "set_values" {
  description = "Commands for adding values to every Secret Manager container before applying the matching run environment."

  value = join("\n", concat(
    [
      "# Run these one at a time. Each prompts for its own value, reads it without",
      "# echoing, and writes it with no trailing newline. Works in zsh and bash.",
      "#",
    ],
    [
      for k, s in google_secret_manager_secret.agent :
      "printf '${local.secrets[k].env_var}: '; IFS= read -rs ${local.secrets[k].env_var}; echo; printf '%s' \"$${${local.secrets[k].env_var}}\" | gcloud secrets versions add ${s.secret_id} --data-file=- --project=${var.project_id}; unset ${local.secrets[k].env_var}"
    ],
  ))
}


# ─────────────────────────────────────────────────────────────────────────────
# Pre-deployment check
# ─────────────────────────────────────────────────────────────────────────────
#
# Run this before applying the matching run-<env>/ module.
#
# For each Secret Manager container, the command prints the number of ENABLED
# secret versions.
#
# Expected:
#
#   mydeck-agent-dev-service-secret: 1
#   mydeck-agent-dev-ai-api-key:     1
#
# A result of:
#
#   0
#
# means the secret has no enabled value yet and should be populated before
# Cloud Run is deployed.
#
# This checks the out-of-band step that Terraform itself deliberately does not
# manage.
# ─────────────────────────────────────────────────────────────────────────────

output "unset_check" {
  description = "Command that prints the number of enabled versions for every secret managed by this Terraform root."

  value = "for s in ${join(" ", [for s in google_secret_manager_secret.agent : s.secret_id])}; do printf '%s: ' \"$s\"; gcloud secrets versions list \"$s\" --project=${var.project_id} --filter='state=ENABLED' --format='value(name)' | wc -l; done"
}