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
  backend "gcs" {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "iam"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
