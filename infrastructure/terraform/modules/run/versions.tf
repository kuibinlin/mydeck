# A CHILD module, not a root. Two things are deliberately absent:
#
#   backend    state belongs to the calling root. One module, two states —
#              run-dev and run-prod — and that separation is what makes an
#              apply against dev incapable of touching the production service.
#
#   provider   inherited from the caller, so the root decides the project and
#              region rather than the module choosing for it.
terraform {
  required_version = "~> 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}
