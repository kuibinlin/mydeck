terraform {
  required_version = "~> 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # One prefix per root module. Like secrets-dev/, the prefix carries the
  # environment — that state boundary is what makes an apply here incapable of
  # touching production, not the directory name.
  backend "gcs" {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "run-prod"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
