# Terraform state bucket.
#
# Every other root module in this repository stores its state here.
# Losing this bucket means losing Terraform's mapping between configuration
# and the resources it manages, potentially requiring state recovery or
# resource imports before Terraform can safely manage the infrastructure again.
#
# The GCS Terraform backend supports state locking; no separate lock-table
# resource is required.

resource "google_storage_bucket" "state" {
  name     = "${var.project_id}-tfstate"
  project  = var.project_id
  location = var.region

  # Keep previous generations of the state object for recovery.
  versioning {
    enabled = true
  }

  # Do not allow Terraform to automatically empty the bucket in order
  # to destroy it.
  force_destroy = false

  # Require a deliberate configuration change before this bucket can
  # be destroyed or replaced.
  lifecycle {
    prevent_destroy = true
  }

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Deleted objects remain recoverable for 7 days.
  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  # Retain a useful history without accumulating unlimited old generations.
  lifecycle_rule {
    condition {
      num_newer_versions = 20
      with_state         = "ARCHIVED"
    }

    action {
      type = "Delete"
    }
  }

  # Terraform state can contain sensitive resource attributes and must
  # therefore be treated as sensitive data.
  labels = {
    app       = "mydeck"
    managed   = "terraform"
    component = "tfstate"
  }
}