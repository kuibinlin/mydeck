# Cloudflare resources that already exist.
#
# ─────────────────────────────────────────────────────────────────────────────
# THIS MODULE ADOPTS. IT DOES NOT CREATE.
# ─────────────────────────────────────────────────────────────────────────────
#
# Every resource below is running right now and holds live data: a database of
# real users and decks, a namespace holding every active session. Terraform is
# being pointed at them, not asked to make them.
#
# That inverts the usual direction of a plan. The rule:
#
#   After importing, `terraform plan` MUST report
#   0 to add, 0 to change, 0 to destroy.
#
#   If it proposes a change, the CONFIGURATION is wrong — not the
#   infrastructure. Fix the .tf file. Never apply a diff you did not intend,
#   because the thing on the other side is production.
#
# That is the whole discipline of adoption, and it is why this is a different
# exercise from the GCP modules (docs/architecture.md §9.1): those created
# resources that had never existed, so a plan full of additions was correct.
# Here a plan full of anything is a bug.
#
# Import commands are in README.md in this directory.
#
# ─────────────────────────────────────────────────────────────────────────────
# NOT HERE, and not by accident
# ─────────────────────────────────────────────────────────────────────────────
#
#   The Worker script     cloudflare_workers_script couples `content`,
#                         `bindings`, `compatibility_date` and `observability`
#                         into ONE resource — the same set wrangler.toml
#                         declares and `wrangler deploy` uploads. There is no
#                         seam: whichever tool uploads the script owns its
#                         bindings. Terraform creates the D1 database and the KV
#                         namespace; wrangler.toml binds them. §9.
#
#   Cloudflare secrets    cloudflare_workers_secret was removed in provider v5,
#                         so §10 enforces itself here. `wrangler secret put`.
#
#   DNS records           Not yet. mydeckapi.linsnotes.com is a Worker custom
#                         domain and mydeck.linsnotes.com is likely a Pages one,
#                         and Cloudflare CREATES AND MANAGES those records
#                         itself. Importing a Cloudflare-managed record can
#                         produce a fight neither side wins — the same class of
#                         problem as workers_script. Listed and decided in a
#                         second pass; see README.md.

data "cloudflare_zone" "main" {
  filter = {
    name = var.zone_name
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# D1 — the database
# ─────────────────────────────────────────────────────────────────────────────
#
# 61 `.prepare()` call sites across 7 files depend on this (§3). Users, decks,
# cards, scores, ai_usage_log.
#
# The Worker binds it by NAME in wrangler.toml, so `name` here is a cross-file
# contract rather than a label. Renaming it in Terraform would leave the Worker
# binding a database that no longer answers to that name.
resource "cloudflare_d1_database" "main" {
  account_id = var.account_id
  name       = var.d1_database_name

  # Declared to match what is already set. Omitted, the provider reads the
  # absence as "remove it" — the plan proposed exactly that on the first run.
  # Disabled is the default and the right setting: read replication is for
  # globally distributed reads, and this database is read and written by one
  # regional Worker.
  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    # Replacement destroys the database and everything in it. Unlike the GCS
    # state bucket, there is no versioning behind this and no undelete — a
    # replaced D1 is gone.
    #
    # Terraform proposes replacement for reasons that look innocuous in a diff,
    # so this is the guard that turns "0 to change" from a habit into a rule.
    prevent_destroy = true
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# KV — sessions and magic-link tokens
# ─────────────────────────────────────────────────────────────────────────────
#
# Losing this logs out every user at once. Sessions are opaque random tokens
# with a 30-day TTL and no other copy — they cannot be regenerated, only
# reissued by making everyone log in again.
#
# The Worker binds this by ID, not by title, so `title` is the human label. The
# ID is what import supplies and what wrangler.toml already holds.
resource "cloudflare_workers_kv_namespace" "sessions" {
  account_id = var.account_id
  title      = var.kv_namespace_title

  lifecycle {
    prevent_destroy = true
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Pages — the frontend
# ─────────────────────────────────────────────────────────────────────────────
#
# The reason this module has a concrete incident behind it rather than a
# hypothetical: the Pages build broke on the repository restructure because its
# output directory still said `dist` while the artifact had moved to
# `frontend/dist`, and nothing in the repo could be checked against.
#
# The build settings recorded in infrastructure/README.md come from here once
# this is adopted — a diff instead of a rediscovery.
#
# Note deployments are NOT managed. Pages builds on push through its GitHub
# integration; Terraform owns the project's configuration, not its releases.
# Same split as the Worker, and as Cloud Run's image.
resource "cloudflare_pages_project" "frontend" {
  account_id        = var.account_id
  name              = var.pages_project_name
  production_branch = "main"

  # ───────────────────────────────────────────────────────────────────────────
  # THE THREE SETTINGS THAT BROKE.
  #
  # When the repository was restructured, destination_dir still said `dist`
  # while the artifact had moved to `frontend/dist`. The Pages build failed and
  # nothing in the repo could be checked against — the values existed only in a
  # dashboard.
  #
  # Import put them in STATE, which already beats that. Declaring them here does
  # the rest: a change now shows up as a plan diff instead of as a red build
  # nobody can explain.
  #
  # root_dir is "" rather than "/" — that is what the API reports, and the
  # difference matters to Terraform even though both mean the repo root. The
  # build runs from there because npm workspaces resolve from the repo root, and
  # `npm run build` delegates to the frontend workspace.
  # ───────────────────────────────────────────────────────────────────────────
  build_config = {
    build_command   = "npm run build"
    destination_dir = "frontend/dist"
    root_dir        = ""
  }

  # ───────────────────────────────────────────────────────────────────────────
  # The GitHub connection, written down for the first time.
  #
  # Omitting this block does not mean "leave it alone" — it means "remove it".
  # The first plan after import proposed exactly that: deleting `source`, which
  # would disconnect the repository and stop Pages building on push entirely.
  #
  # So this is transcribed from what is actually configured rather than
  # authored, which is the whole discipline here. It is also the first time this
  # configuration has existed anywhere outside a dashboard —
  # `preview_deployment_setting = "none"` below is the setting we reasoned our
  # way to and clicked, now recorded with everything else.
  # ───────────────────────────────────────────────────────────────────────────
  source = {
    type = "github"

    config = {
      owner     = "kuibinlin"
      repo_name = "mydeck"

      production_branch              = "main"
      production_deployments_enabled = true
      pr_comments_enabled            = true

      # `deployments_enabled` is deliberately absent. The provider deprecates it
      # in favour of production_deployments_enabled and
      # preview_deployment_setting, both set here — one coarse switch replaced
      # by two that say which half they govern.
      #
      # The API still reports the old field, so this was kept at first on the
      # theory that omitting it would read as "unset this". A plan disproved
      # that: it is Optional+Computed, so leaving it out keeps whatever is set
      # rather than clearing it.

      # Previews are off because a preview of this app cannot log in: CORS
      # rejects *.pages.dev, and the SameSite=Lax cookie needs the shared
      # linsnotes.com eTLD+1. See infrastructure/README.md.
      preview_deployment_setting = "none"

      # preview_branch_includes / _excludes are deliberately NOT declared.
      #
      # Declaring `preview_branch_excludes = []` made an apply fail outright:
      #
      #   Provider produced inconsistent result after apply
      #   .source.config.preview_branch_excludes: was cty.ListValEmpty, but
      #   now null
      #
      # The API normalises an empty list back to null and the provider cannot
      # reconcile the two. Declaring only the includes is no better — the
      # excludes then sit at "known after apply" on every plan and never settle.
      #
      # Leaving both out lets the provider compute them, which is harmless here
      # because previews are off at a level above: preview_deployment_setting
      # is "none", so no branch list is consulted at all.
      #
      # Note this is NOT the same situation as path_excludes below, where the
      # list is non-empty and therefore round-trips cleanly.

      # WHICH CHANGES REBUILD THE FRONTEND.
      #
      # Pages builds frontend/ and nothing else, so a change to the agent
      # service or a Terraform module was rebuilding it for no reason.
      #
      # Broad includes with excludes, rather than narrow includes, because the
      # failure modes are not symmetric. Excludes are evaluated FIRST and a path
      # matching no include is skipped — so a narrow include list that forgets
      # something the build depends on means the site silently stops updating.
      # An over-broad one means a wasted build: visible, cheap, obviously wrong.
      # Fail toward building too often.
      #
      # Left in scope on purpose: the root files. package.json and
      # package-lock.json are the workspace manifest and the only lockfile, and
      # .nvmrc pins the build's Node version — all three genuinely change the
      # artifact. A README edit rebuilding is the price of not enumerating them.
      #
      # backend/ is excluded even though three frontend TESTS import from it
      # (classify, floorPlan, history). Those run in CI, not in the Pages build,
      # and the frontend's own copy of a duplicated file is a separate edit
      # under frontend/ that triggers a build on its own.
      #
      # `*` matches across `/`, so one entry covers a whole subtree —
      # `docs/*` matches `docs/guides/advanced/config.md`.
      path_includes = ["*"]
      path_excludes = [
        "backend/*",
        "services/*",
        "infrastructure/*",
        "docs/*",
        ".github/*",
      ]
    }
  }

  lifecycle {
    # The deployment history is attached to the project. Recreating it is not a
    # data loss on the scale of D1, but it does break the GitHub integration and
    # every custom domain pointed at it.
    prevent_destroy = true

    # ─────────────────────────────────────────────────────────────────────
    # THIS RESOURCE NEVER PLANS CLEAN. That is a provider defect, not drift.
    # ─────────────────────────────────────────────────────────────────────
    #
    # Every plan reports an in-place update of four attributes:
    #
    #   build_config.build_caching, .web_analytics_tag, .web_analytics_token
    #   source.config.preview_branch_excludes
    #
    # All four are optional-and-computed and absent from the API, so the
    # provider marks them unknown on every plan. Applying writes nothing.
    #
    # There is no configuration that fixes it, and both directions were tried:
    #
    #   declare them   `preview_branch_excludes = []` FAILED an apply outright —
    #                  the API normalises empty to null and the provider cannot
    #                  reconcile it. web_analytics_token is sensitive and
    #                  unknowable, so build_config cannot be completed either.
    #
    #   ignore_changes does nothing. It suppresses differences between config
    #                  and prior state; this is the provider returning unknown,
    #                  which is not that comparison.
    #
    # So the noise is accepted deliberately. What it costs is a plan that is
    # never empty; what it buys is the three build settings below being
    # DECLARED, so the change that actually broke production — destination_dir
    # silently wrong after the restructure — shows as `~ destination_dir` in a
    # diff rather than as a red build nobody can explain.
    #
    # Reading a plan for this resource: ignore the four names above; anything
    # else is real.
    # ─────────────────────────────────────────────────────────────────────
  }
}
