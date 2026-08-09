terraform {
  required_version = "~> 1.15"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # One prefix per root module, in the bucket bootstrap created.
  #
  # Note what this means: a CLOUDFLARE root keeping its state in GOOGLE Cloud
  # Storage. That is deliberate — one state bucket, one backup story, one place
  # that has to survive. The provider a module talks to and the place it keeps
  # its bookkeeping are unrelated decisions.
  backend "gcs" {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "cloudflare"
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment. Deliberately NOT a variable:
# a token passed through Terraform would be a token written into state in
# plaintext, in a versioned bucket that keeps 20 generations. docs/architecture.md
# §10.
#
# This token is NOT the deploy token in GitHub Actions secrets. That one is
# scoped to Workers Scripts:Edit and ships the Worker; this one can rewrite DNS
# and must never reach CI. Two tokens, two scopes, two holders.
provider "cloudflare" {}
