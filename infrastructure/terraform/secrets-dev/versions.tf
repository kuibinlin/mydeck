terraform {
  required_version = "~> 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # One prefix per root module, in the bucket bootstrap created. A backend block
  # cannot read variables, so the bucket name is written out rather than derived
  # from var.project_id.
  #
  # The prefix carries the environment, and that is what actually implements the
  # per-environment split. Directory names and comments are documentation; the
  # state boundary is the enforcement. secrets-prod/ will use "secrets-prod", so
  # an apply here has no prod resources in scope to change.
  #
  # Changing this after a first apply strands the state at the old prefix and
  # needs `terraform init -migrate-state`, so it is settled before anything is
  # created.
  backend "gcs" {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "secrets-dev"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
