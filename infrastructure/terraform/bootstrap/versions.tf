terraform {
  required_version = "~> 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  backend "gcs" {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "bootstrap"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # ───────────────────────────────────────────────────────────────────────────
  # Required by google_billing_budget, and by nothing else in this repository.
  #
  # The Budgets API refuses calls that are not attributed to a quota project.
  # Application Default Credentials do not set one, so the request is billed to
  # Google's shared default consumer (projects/764086051850) — where the API is
  # disabled. The result is a 403 SERVICE_DISABLED arriving seconds after
  # Terraform successfully enabled the service on THIS project, which reads as a
  # contradiction until you notice the consumer in the error is not yours.
  #
  # These two lines say "attribute quota to this project". The alternative is
  # `gcloud auth application-default set-quota-project`, which fixes one laptop;
  # this fixes the repository.
  # ───────────────────────────────────────────────────────────────────────────
  billing_project       = var.project_id
  user_project_override = true
}