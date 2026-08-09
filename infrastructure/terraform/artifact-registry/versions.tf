terraform {
  required_version = "~> 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # Unlike bootstrap, this module uses the remote backend from its first init:
  # bootstrap already created the bucket, so there is no local-state phase and
  # no `-migrate-state` step. One prefix per root module keeps their state
  # separate inside the shared bucket.
  #
  # A backend block cannot read variables, so the bucket name is written out
  # rather than derived from var.project_id.
  backend "gcs" {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "artifact-registry"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
