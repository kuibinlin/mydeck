output "state_bucket" {
  description = "Name of the GCS bucket used to store Terraform state."
  value       = google_storage_bucket.state.name
}

output "enabled_apis" {
  description = "Google Cloud APIs enabled by this bootstrap."
  value       = sort([for s in google_project_service.enabled : s.service])
}

output "budget" {
  description = "What the budget alerts on, and what it does not do."

  # Stated plainly because "we have a budget" reads as a spending cap and is
  # not one. Nothing here stops a charge.
  value = "${var.budget_amount} ${var.budget_currency}/month on ${var.project_id}, measured on GROSS usage BEFORE credits — so a runaway trips it even while free credits absorb the cost, which is the point. Emails billing admins at 50%, 90%, 100%, and when the month is FORECAST to exceed. It caps nothing: GCP has no hard stop short of detaching billing."
}
