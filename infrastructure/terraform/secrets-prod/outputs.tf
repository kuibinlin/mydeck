# Passed straight through from the module.
#
# run-<env>/ reads secret_ids and secret_env_vars from THIS root's state, so
# they have to surface here — a module output that no root re-exports is
# invisible to terraform_remote_state.
#
# The descriptions live in ../modules/secrets/outputs.tf, which is also where
# the reasoning is: why set_values prompts by name, why unset_check exists, and
# why neither ever prints a secret value.

output "secret_ids" {
  description = "Secret Manager secret IDs keyed by logical secret type."
  value       = module.secrets.secret_ids
}

output "secret_env_vars" {
  description = "Container environment variable associated with each logical secret type."
  value       = module.secrets.secret_env_vars
}

output "set_values" {
  description = "Commands for adding a value to every secret. Read with `terraform output -raw set_values`."
  value       = module.secrets.set_values
}

output "unset_check" {
  description = "One command that counts enabled versions per secret. Run before applying the matching run-<env>/."
  value       = module.secrets.unset_check
}
