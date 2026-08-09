terraform {
  required_version = "~> 1.15"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }

  # Same bucket as every other root, different prefix. A GitHub root keeping its
  # state in Google Cloud Storage is deliberate: one bucket, one backup story,
  # one thing that has to survive. Which provider a module talks to and where it
  # keeps its bookkeeping are unrelated decisions.
  backend "gcs" {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "github"
  }
}

# Reads GITHUB_TOKEN from the environment. Deliberately not a variable — a token
# passed through Terraform is a token written into state in plaintext, in a
# versioned bucket. docs/architecture.md §10.
provider "github" {
  owner = var.github_owner
}
