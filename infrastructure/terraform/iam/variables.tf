variable "project_id" {
  description = "Google Cloud project ID that owns the MyDeck infrastructure."
  type        = string

  # Repeated from bootstrap rather than inherited, for the same reason
  # artifact-registry repeats it: each root module has its own tfvars, and a
  # typo here would target the wrong Google Cloud project.
  validation {
    condition     = can(regex("^mydeck($|-)", var.project_id))
    error_message = "project_id must be 'mydeck' or start with 'mydeck-'. Relax this validation deliberately if a different project naming scheme is intended."
  }
}

variable "region" {
  description = "Default Google Cloud region used by this module."
  type        = string
  default     = "asia-southeast1"
}

# ─────────────────────────────────────────────────────────────────────────────
# Environments
# ─────────────────────────────────────────────────────────────────────────────
#
# One runtime service account is created per environment listed here, named:
#
#   mydeck-agent-<env>-runtime
#
# to match the Cloud Run services pinned in docs/architecture.md §12:
#
#   mydeck-agent-dev
#   mydeck-agent-prod
#
# Why per environment rather than one shared runtime identity:
#
# secrets/ grants secretmanager.secretAccessor per secret, so that the running
# container can read only what it needs. A single runtime account shared by dev
# and prod defeats that entirely — both services would be the same principal, so
# any secret readable by one is readable by the other. Per-secret grants cannot
# separate what the identity has already merged.
#
# The deploy service account is deliberately NOT per environment. It is one CI
# identity for the project, and §9.4 restricts deployment to a single ref rather
# than to a single environment.
#
# Defaults to dev alone. Add "prod" when a production service actually exists,
# rather than creating an identity now for something that does not.
# ─────────────────────────────────────────────────────────────────────────────

variable "environments" {
  description = "Environments to create a runtime service account for. Add \"prod\" when the production Cloud Run service exists."
  type        = set(string)
  default     = ["dev"]

  validation {
    condition     = length(var.environments) > 0
    error_message = "environments must list at least one environment; an empty set creates no runtime identity for Cloud Run to run as."
  }

  # account_id is capped at 30 characters, and the name template spends 21 of
  # them ("mydeck-agent-" + "-runtime"). Caught here because the Google API
  # error for an over-long account_id does not mention which part was too long.
  validation {
    condition     = alltrue([for e in var.environments : can(regex("^[a-z][a-z0-9-]{0,8}$", e))])
    error_message = "Each environment must be 1-9 characters, lowercase letters, digits or hyphens, starting with a letter — so that mydeck-agent-<env>-runtime fits the 30-character account_id limit."
  }
}

variable "artifact_repository_id" {
  description = "Artifact Registry repository the deploy account may push to. Must match repository_id in the artifact-registry module."
  type        = string
  default     = "mydeck-images"

  # Repeated rather than read through terraform_remote_state, matching how
  # project_id is repeated across root modules.
  #
  # The repository ID is a stable cross-module contract documented in the
  # architecture. Reading remote state only to recover this fixed name would
  # introduce an unnecessary dependency between the iam and artifact-registry
  # Terraform states.
  #
  # If the repository name deliberately changes, update this value and the
  # architecture documentation together.
}


# ─────────────────────────────────────────────────────────────────────────────
# Trusted GitHub identity
# ─────────────────────────────────────────────────────────────────────────────
#
# These values define the GitHub identity that the WIF and IAM configuration
# will trust.
#
# The actual security boundary is enforced by the combination of:
#
#   - these values
#   - the WIF provider's attribute_condition
#   - the service-account IAM principal binding
#   - the permissions granted to the deploy service account
#
# WIF replaces a downloadable service account key with cryptographically
# verified workload identity. GitHub presents a short-lived OIDC token carrying
# claims such as repository owner, repository and ref; Google verifies those
# claims before allowing the workflow to impersonate the deploy service account.
#
# The repository may be public. Resource identifiers such as the pool name,
# provider name and service account emails are not secrets and may appear in
# workflow configuration or logs.
#
# WIF security must therefore never depend on those identifiers being hidden.
# It depends on correctly validating the signed GitHub claims and granting only
# the required IAM permissions.
#
# Owner and repository are separate variables so neither can accidentally
# absorb the other.
# ─────────────────────────────────────────────────────────────────────────────

variable "github_owner" {
  description = "GitHub user or organisation that owns the repository. Not a full owner/repo path."
  type        = string

  validation {
    condition = (
      length(trimspace(var.github_owner)) > 0 &&
      !strcontains(var.github_owner, "/")
    )

    error_message = "github_owner must be the non-empty owner name alone, with no slash. Put the repository name in github_repository."
  }
}

variable "github_repository" {
  description = "Repository name alone, without the owner. The owner/name path is composed in workload-identity.tf."
  type        = string

  validation {
    condition = (
      length(trimspace(var.github_repository)) > 0 &&
      !strcontains(var.github_repository, "/")
    )

    error_message = "github_repository must be the non-empty repository name alone, with no slash. Put the owner in github_owner."
  }
}

variable "deploy_ref" {
  description = "Git ref allowed to impersonate the deploy service account."
  type        = string
  default     = "refs/heads/main"

  # GitHub's OIDC `ref` claim contains a full ref such as:
  #
  #   refs/heads/main
  #
  # Using only "main" would never match the claim and deployment
  # authentication would fail.
  validation {
    condition     = startswith(var.deploy_ref, "refs/")
    error_message = "deploy_ref must be a full git ref such as 'refs/heads/main', not a bare branch name."
  }
}