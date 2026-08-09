# Repository governance, and the wiring between the other two providers.
#
# The third Terraform lifecycle (docs/architecture.md §9.1): GCP was CREATE,
# Cloudflare was ADOPT, this is GOVERN and CONNECT. Nothing here provisions
# anything — it configures a repository that exists and publishes values another
# module already computed.
#
# ─────────────────────────────────────────────────────────────────────────────
# THIS ROOT APPLIES LOCALLY. NEVER FROM CI.
# ─────────────────────────────────────────────────────────────────────────────
#
# Its credential is a repo-admin PAT. Held in Actions secrets, that would put
# the credential which governs the repository inside the repository it governs —
# able to delete the branch protection that made a merge "reviewed" in the first
# place. §9.4.
#
# So GITHUB_TOKEN comes from the environment, the same way the Cloudflare token
# does, and neither ever becomes a Terraform variable.

# ─────────────────────────────────────────────────────────────────────────────
# Upstream state
#
# These are the outputs of two GCP roots, read across provider boundaries. This
# is the piece that makes the module more than an exercise: the values below are
# produced by Terraform and consumed by GitHub Actions, so a WIF provider path
# nobody types correctly twice is never typed at all.
# ─────────────────────────────────────────────────────────────────────────────

data "terraform_remote_state" "iam" {
  backend = "gcs"

  config = {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "iam"
  }
}

data "terraform_remote_state" "artifact_registry" {
  backend = "gcs"

  config = {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "artifact-registry"
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Actions VARIABLES — never secrets
# ─────────────────────────────────────────────────────────────────────────────
#
# github_actions_secret requires the VALUE, so declaring one writes a credential
# into Terraform state in plaintext. That is the rule §10 exists for, and it is
# why this module publishes identifiers only. Secrets are set through the GitHub
# UI or `gh`, out of band, exactly as Secret Manager values are.
#
# None of these three is sensitive. The repository is public, and workflow logs
# on a public repo are world-readable — which is fine, because WIF's security
# rests on the provider's attribute_condition pinning the repository, never on
# the provider name being obscure (§9.3).
#
# Published because they are long, derived, and impossible to type correctly
# from memory. PROJECT_ID and REGION stay in the workflow: short, stable, and
# readable at a glance.

resource "github_actions_variable" "wif_provider" {
  repository    = var.github_repository
  variable_name = "GCP_WIF_PROVIDER"
  value         = data.terraform_remote_state.iam.outputs.workload_identity_provider
}

resource "github_actions_variable" "deploy_service_account" {
  repository    = var.github_repository
  variable_name = "GCP_DEPLOY_SA"
  value         = data.terraform_remote_state.iam.outputs.deploy_service_account
}

resource "github_actions_variable" "agent_image" {
  repository    = var.github_repository
  variable_name = "GCP_AGENT_IMAGE"
  value         = data.terraform_remote_state.artifact_registry.outputs.agent_image
}


# ─────────────────────────────────────────────────────────────────────────────
# Branch protection on main
# ─────────────────────────────────────────────────────────────────────────────
#
# A ruleset rather than the older github_branch_protection: the two hit
# different APIs and STACK rather than replace, so declaring both produces
# enforcement that is hard to reason about. Rulesets are where GitHub is
# steering.
#
# Be honest about what this is for a solo repository. Repository admins are
# bypass actors below, so this is a guardrail rather than a gate — it makes the
# default path safe and stays escapable. Without a bypass, a failing required
# check would leave nobody able to merge an emergency fix, which for a
# single-maintainer repo is a worse failure than the one being prevented.
#
# What it genuinely buys, even solo:
#
#   - every change to main arrives through a pull request, so ci.yml RUNS
#     before merge rather than after — which is the drift that let production
#     serve ten-day-old code with an already-fixed defect in it
#   - force pushes and deletion of main are blocked
#   - the rules are a reviewable diff instead of a dashboard toggle nobody
#     remembers changing
# ─────────────────────────────────────────────────────────────────────────────

resource "github_repository_ruleset" "main" {
  name        = "main"
  repository  = var.github_repository
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  bypass_actors {
    actor_id    = 5 # RepositoryRole: admin
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  rules {
    # main only moves forward. A force push rewrites history other clones and
    # the deploy workflows have already acted on.
    non_fast_forward = true

    # Nothing deletes the default branch.
    deletion = true

    pull_request {
      # ZERO, deliberately. A single maintainer cannot approve their own pull
      # request, so requiring an approval would make main unmergeable. The value
      # here is the pull request existing at all — it is what makes ci.yml run
      # before the merge instead of after it.
      required_approving_review_count = 0

      dismiss_stale_reviews_on_push = true
      require_last_push_approval    = false
    }

    required_status_checks {
      dynamic "required_check" {
        for_each = var.required_checks

        content {
          context = required_check.value
        }
      }

      strict_required_status_checks_policy = false
      # Not strict: strict requires the branch to be up to date with main before
      # merging, which on a repository with one maintainer means rebasing to
      # satisfy a race that cannot happen.
    }
  }
}
