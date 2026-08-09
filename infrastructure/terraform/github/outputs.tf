output "published_variables" {
  description = "Actions variables this module publishes from GCP Terraform outputs. Identifiers, not secrets."

  value = {
    GCP_WIF_PROVIDER = github_actions_variable.wif_provider.value
    GCP_DEPLOY_SA    = github_actions_variable.deploy_service_account.value
    GCP_AGENT_IMAGE  = github_actions_variable.agent_image.value
  }
}

output "ruleset_summary" {
  description = "What main is protected by, in one line."

  # The dangerous property of this module is what it does and does not prevent.
  # Repository admins bypass everything below, so this is a guardrail, not a
  # gate — worth saying out loud rather than reconstructing from bypass_actors.
  value = "main: PR required (0 approvals), checks ${join("/", var.required_checks)}, no force-push, no delete — repository admins bypass all of it"
}
