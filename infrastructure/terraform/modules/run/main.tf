# The agent service on Cloud Run.
#
# docs/architecture.md §11 step 5. This is where the Python loop finally has an
# address; nothing calls it until AGENT_SERVICE_URL is set in the Worker and a
# flag is turned on, which is steps 6-8.

# ─────────────────────────────────────────────────────────────────────────────
# Upstream state
# ─────────────────────────────────────────────────────────────────────────────
#
# Two dependencies, both on outputs from separate Terraform roots:
#
#   iam/            the runtime identity this service runs as,
#                   and the deploy identity granted run.developer below
#
#   secrets-<env>/  the Secret Manager containers mounted as env vars
#
# Terraform builds a dependency graph WITHIN this root — data source → locals →
# resource — and orders those correctly. What it does not have is one graph
# spanning iam/, secrets-<env>/ and here, because those are separate states. So
# apply order across roots is operational, not enforced:
#
#   iam/ → secrets-<env>/ → run-<env>/
#
# The preconditions below are the compensation: a root applied out of order
# fails with a sentence naming what to apply first.
# ─────────────────────────────────────────────────────────────────────────────

data "terraform_remote_state" "iam" {
  backend = "gcs"

  config = {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "iam"
  }
}

data "terraform_remote_state" "secrets" {
  backend = "gcs"

  config = {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "secrets-${var.environment}"
  }
}

locals {
  service_name = "mydeck-agent-${var.environment}"

  # lookup with a default rather than a bare index, so a missing environment
  # produces the precondition's sentence rather than Terraform's generic
  # "the given key does not identify an element in this collection value".
  runtime_service_accounts = data.terraform_remote_state.iam.outputs.runtime_service_accounts
  runtime_service_account  = lookup(local.runtime_service_accounts, var.environment, "")

  deploy_service_account = data.terraform_remote_state.iam.outputs.deploy_service_account

  # { "ai-api-key" = "mydeck-agent-dev-ai-api-key", ... }
  # { "ai-api-key" = "AI_API_KEY", ... }
  #
  # Read as a pair so the correspondence lives in secrets-<env>/ and is never
  # retyped here — a mismatch would deploy cleanly and fail at the first model
  # call. Adding a secret there mounts it here with no change to this file.
  secret_ids      = data.terraform_remote_state.secrets.outputs.secret_ids
  secret_env_vars = data.terraform_remote_state.secrets.outputs.secret_env_vars

  # The logical secret types the container cannot run without, as opposed to the
  # Langfuse pair which is optional. These strings are the keys of
  # local.required_secrets in secrets-<env>/ — a cross-module contract, so
  # renaming one there needs a matching change here.
  required_secret_types = toset([
    "service-secret",
    "ai-api-key",
  ])

  # Both sides converted explicitly. setsubtract takes sets, and leaning on
  # Terraform's implicit list→set conversion hides that this is a set
  # difference rather than some list operation.
  missing_secret_types = setsubtract(
    local.required_secret_types,
    toset(keys(local.secret_ids)),
  )
}


resource "google_cloud_run_v2_service" "agent" {
  project  = var.project_id
  name     = local.service_name
  location = var.region

  # ───────────────────────────────────────────────────────────────────────────
  # PUBLIC INGRESS — A DEV POSTURE, NOT THE INTENDED PRODUCTION PERIMETER
  # ───────────────────────────────────────────────────────────────────────────
  #
  # docs/architecture.md §7.3 holds the reasoning; the decision is:
  #
  # Cloud Run IAM authentication needs a Google-compatible caller identity, and
  # the Worker integration has no configured keyless Google identity flow. Given
  # the alternative was storing a long-lived Google service account key in
  # Cloudflare, dev uses public invocation plus an application-layer shared
  # secret. A keyless integration can be evaluated later if the added complexity
  # earns itself — this is a judgement about cost, not a claim of impossibility.
  #
  # THE AUTHORIZATION BOUNDARY IS THE APPLICATION, NOT CLOUD RUN IAM.
  #
  # app/main.py:require_secret is the whole gate: hmac.compare_digest against
  # AGENT_SERVICE_SECRET, 401 on mismatch, and 503 when the secret is unset on
  # Cloud Run — so a misconfiguration fails closed rather than serving to
  # anyone. /health and /version are deliberately open; /internal/agent/turn is
  # not.
  #
  # What this is NOT protected by, despite §7.3 once implying otherwise:
  #
  #   A proxied Cloudflare custom domain does NOT prevent bypass. It applies the
  #   WAF and rate limits to traffic that goes THROUGH Cloudflare, while the
  #   default *.run.app endpoint stays directly reachable. Anyone who has the
  #   URL skips the WAF entirely.
  #
  # Closing that needs ingress restricted to a load balancer:
  #
  #   Cloudflare → Google External Application Load Balancer → Cloud Run
  #   with ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  #   and optionally the default run.app URL disabled
  #
  # That is deliberately NOT built here. This is dev: reachable by one
  # allowlisted account through a Worker whose flags all ship off. The load
  # balancer is a run-prod/ decision, recorded as open in §13.
  # ───────────────────────────────────────────────────────────────────────────
  ingress = "INGRESS_TRAFFIC_ALL"

  # Provider v6 began defaulting this to true, which blocks `terraform destroy`
  # with an error that reads like a bug. Dev is meant to be disposable; set it
  # explicitly rather than inheriting a default that changed under us.
  deletion_protection = false

  template {
    # What the container runs AS. Not the deploy identity — see iam/.
    service_account = local.runtime_service_account

    timeout                          = "${var.request_timeout_s}s"
    max_instance_request_concurrency = var.concurrency

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.bootstrap_image

      # The Dockerfile reads $PORT rather than assuming 8080, and Cloud Run
      # injects it. Declared so the two agree explicitly.
      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }

        # CPU throttled between requests. The loop spends most of a turn waiting
        # on the model, so paying for allocated-but-idle CPU buys nothing.
        cpu_idle = true

        # Cold start is on the critical path of a learner-facing request, and
        # LangChain's import graph is large — the Dockerfile pre-compiles
        # bytecode for the same reason.
        startup_cpu_boost = true
      }

      # Plain configuration. Only the secret-valued vars come from Secret
      # Manager; app/config.py falls back to its own defaults for anything
      # unset, so this list is the deliberate overrides rather than everything.
      env {
        name  = "AI_PROVIDER"
        value = var.ai_provider
      }

      env {
        name  = "AI_TUTOR_MODEL"
        value = var.ai_model
      }

      env {
        name  = "AI_TEMPERATURE"
        value = tostring(var.ai_temperature)
      }

      env {
        name  = "AGENT_DEADLINE_S"
        value = tostring(var.agent_deadline_s)
      }

      dynamic "env" {
        for_each = var.ai_base_url == "" ? [] : [var.ai_base_url]

        content {
          name  = "AI_BASE_URL"
          value = env.value
        }
      }

      # Secret mounts, one per container created by secrets-<env>/.
      #
      # Version comes from var.secret_versions, defaulting to "latest".
      #
      # Env-var secrets resolve when an INSTANCE starts, not when a revision is
      # created — so under "latest" a rotation leaves instances of the same
      # revision holding different values until the old ones are recycled. Dev
      # accepts that and handles it with a restart (docs/secrets.md); production
      # should pin, which makes rotation deliberate and reversible.
      dynamic "env" {
        for_each = local.secret_ids

        content {
          name = local.secret_env_vars[env.key]

          value_source {
            secret_key_ref {
              secret  = env.value
              version = lookup(var.secret_versions, env.key, "latest")
            }
          }
        }
      }

      # /health is unauthenticated precisely so this can reach it.
      #
      # Without a startup probe, Cloud Run considers the container ready as soon
      # as the port is open, so a build that boots and then fails to import
      # would take traffic and return 500s. With it, a broken revision fails the
      # deploy instead.
      #
      # 6 × 5s allows ~30s to become ready, which is cold start plus the
      # LangChain import graph, not a guess at steady-state latency.
      startup_probe {
        http_get {
          path = "/health"
        }

        initial_delay_seconds = 0
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 6
      }
    }
  }

  labels = {
    app         = "mydeck"
    managed     = "terraform"
    component   = "agent"
    environment = var.environment
  }

  lifecycle {
    # ─────────────────────────────────────────────────────────────────────────
    # The ownership split, expressed
    # ─────────────────────────────────────────────────────────────────────────
    #
    # Without this, every CI deploy puts Terraform permanently out of date, and
    # the next `terraform apply` rolls production back to whatever tag is
    # written in a .tf file. This is the same collision as Cloudflare's
    # workers_script, one layer up, and it takes the same resolution.
    #
    # client / client_version are set by `gcloud run deploy` on every CI deploy.
    # They describe which tool last touched the service, which is not something
    # Terraform has an opinion about — left unignored they are permanent drift.
    #
    # If a future CI change introduces other drift, add the specific field here
    # rather than reaching for a broader ignore. The list is meant to be read.
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]

    precondition {
      condition     = local.runtime_service_account != ""
      error_message = "iam/ has no runtime service account for environment '${var.environment}' (it knows about: ${join(", ", keys(local.runtime_service_accounts))}). Add '${var.environment}' to environments in iam/terraform.tfvars, apply iam/, then retry here."
    }

    # Names the missing secrets rather than counting them. `length(...) > 0`
    # would pass on a set containing only the optional Langfuse pair, deploying
    # a service with no AGENT_SERVICE_SECRET — which then 503s on every request
    # because app/main.py refuses to serve unconfigured.
    #
    # This checks the containers EXIST. It cannot check they hold values; that
    # is `terraform output -raw unset_check` in secrets-<env>/, and an empty
    # container fails the mount at apply.
    precondition {
      condition     = length(local.missing_secret_types) == 0
      error_message = "secrets-${var.environment}/ is missing required secret(s): ${join(", ", local.missing_secret_types)}. It provides: ${join(", ", keys(local.secret_ids))}. Apply that module first, then populate the values — see docs/secrets.md."
    }
  }
}
