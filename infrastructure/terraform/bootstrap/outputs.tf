output "state_bucket" {
  description = "Name of the GCS bucket used to store Terraform state."
  value       = google_storage_bucket.state.name
}

output "enabled_apis" {
  description = "Google Cloud APIs enabled by this bootstrap."
  value       = sort([for s in google_project_service.enabled : s.service])
}
