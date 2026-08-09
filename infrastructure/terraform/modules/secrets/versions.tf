# A CHILD module, not a root. Two things are deliberately absent:
#
#   backend    state belongs to the root that calls this. One module, two
#              states — secrets-dev and secrets-prod — and that separation is
#              what makes an apply in dev incapable of touching production.
#
#   provider   inherited from the caller. Declaring one here would let this
#              module choose its own project and region, which is exactly the
#              decision the root should own.
#
# required_providers stays: it declares what this module NEEDS, which is a
# property of the code rather than of any one caller.
terraform {
  required_version = "~> 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}
