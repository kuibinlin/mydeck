# ─────────────────────────────────────────────────────────────────────────────
# Secret Manager containers for the agent service
# ─────────────────────────────────────────────────────────────────────────────
#
# TERRAFORM CREATES SECRET CONTAINERS AND IAM ACCESS.
# TERRAFORM NEVER SETS THE SECRET VALUES.
#
# Terraform state records managed resource attributes and should be treated as
# sensitive. Passing a secret value through Terraform can cause that value to
# appear in Terraform state and historical state versions.
#
# For that reason this module deliberately contains NO:
#
#   google_secret_manager_secret_version
#
# resource.
#
# Terraform creates the Secret Manager containers and the IAM bindings that
# allow the environment's Cloud Run runtime identity to read them.
#
# Actual secret values are added out of band with gcloud.
#
# Example:
#
#   read -rs VALUE
#   echo
#
#   echo -n "$VALUE" | gcloud secrets versions add <SECRET_ID> \
#     --data-file=- \
#     --project=mydeck-linsnotes
#
# `terraform output set_values` provides the exact commands for the secrets
# created by this root module.
#
# docs/architecture.md §10.
#
#
# ─────────────────────────────────────────────────────────────────────────────
# REQUIRED ORDER
# ─────────────────────────────────────────────────────────────────────────────
#
# 1. terraform apply                (this module)
#      ↓
#    creates empty Secret Manager containers
#
# 2. gcloud secrets versions add    (out of band)
#      ↓
#    adds the actual values
#
# 3. verify every required secret has an enabled version
#
# 4. terraform apply                (matching run-<env>/ module)
#      ↓
#    Cloud Run mounts / references those secrets
#
# This module intentionally does not manage secret versions, so it cannot itself
# enforce the human value-setting step.
#
# A Cloud Run deployment that references an empty secret will fail later.
# The outputs from this module include a verification command to catch that
# before applying run-<env>/.
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# IAM state
# ─────────────────────────────────────────────────────────────────────────────
#
# iam/ owns the long-lived identities:
#
#   mydeck-agent-dev-runtime
#   mydeck-agent-prod-runtime
#
# This module reads those generated service-account emails from the iam/
# Terraform state instead of rebuilding the addresses by hand.
#
# The remote state contains non-secret infrastructure identifiers.
# ─────────────────────────────────────────────────────────────────────────────

data "terraform_remote_state" "iam" {
  backend = "gcs"

  config = {
    # Backend configuration cannot use normal Terraform variables here in the
    # same way resource configuration does, so the shared state bucket name is
    # written explicitly.
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "iam"
  }
}


locals {
  # ───────────────────────────────────────────────────────────────────────────
  # Required secret-valued application configuration
  # ───────────────────────────────────────────────────────────────────────────
  #
  # These are values whose disclosure would matter.
  #
  # Plain configuration such as:
  #
  #   AI_PROVIDER
  #   AI_TUTOR_MODEL
  #   AI_BASE_URL
  #   AI_TEMPERATURE
  #   AGENT_DEADLINE_S
  #   HSK_MCP_URL
  #   HSK_TIMEOUT_S
  #
  # belongs in the Cloud Run service definition rather than Secret Manager.
  # ───────────────────────────────────────────────────────────────────────────

  required_secrets = {
    "service-secret" = {
      env_var = "AGENT_SERVICE_SECRET"

      purpose = "Shared secret proving that an agent request came from the Cloudflare Worker. The Cloud Run service refuses to serve without it."
    }

    "ai-api-key" = {
      env_var = "AI_API_KEY"

      purpose = "API credential used by the Python agent when calling its configured LLM provider."
    }
  }


  # ───────────────────────────────────────────────────────────────────────────
  # Optional Langfuse tracing credentials
  # ───────────────────────────────────────────────────────────────────────────
  #
  # The tracing integration requires both values, so they are enabled as a
  # pair rather than allowing one half to exist independently.
  # ───────────────────────────────────────────────────────────────────────────

  tracing_secrets = {
    "langfuse-public-key" = {
      env_var = "LANGFUSE_PUBLIC_KEY"

      purpose = "Langfuse project public key. Managed beside the secret key so tracing configuration is enabled as a complete pair."
    }

    "langfuse-secret-key" = {
      env_var = "LANGFUSE_SECRET_KEY"

      purpose = "Langfuse project secret key."
    }
  }


  # Required secrets are always present.
  #
  # Langfuse secrets are added only when tracing is deliberately enabled.
  secret_types = merge(
    local.required_secrets,
    var.enable_tracing ? local.tracing_secrets : {}
  )


  # ───────────────────────────────────────────────────────────────────────────
  # Environment-specific secret definitions
  # ───────────────────────────────────────────────────────────────────────────
  #
  # This Terraform root owns exactly ONE environment.
  #
  # Examples:
  #
  #   secrets-dev/
  #     environment = "dev"
  #
  #   secrets-prod/
  #     environment = "prod"
  #
  # This means an apply from secrets-dev/ has no prod secrets in its Terraform
  # state and therefore cannot accidentally modify them.
  #
  # Secret IDs follow the common naming pattern:
  #
  #   mydeck-agent-dev-service-secret
  #   mydeck-agent-dev-ai-api-key
  #
  # The for_each key is just the logical secret type. The environment is already
  # fixed by this Terraform root.
  # ───────────────────────────────────────────────────────────────────────────

  secrets = {
    for type, meta in local.secret_types :
    type => {
      environment = var.environment
      secret_id   = "mydeck-agent-${var.environment}-${type}"
      env_var     = meta.env_var
      purpose     = meta.purpose
    }
  }


  # Runtime service accounts are produced by iam/ as a map:
  #
  #   {
  #     dev  = "mydeck-agent-dev-runtime@..."
  #     prod = "mydeck-agent-prod-runtime@..."
  #   }
  #
  # This root deliberately selects exactly one entry.
  runtime_service_accounts = data.terraform_remote_state.iam.outputs.runtime_service_accounts

  # lookup with a default rather than a bare index, so a missing environment
  # produces the precondition's sentence below instead of Terraform's generic
  # "the given key does not identify an element in this collection value" — an
  # error that says nothing about iam/ being the thing to fix.
  #
  # A `check` block would be the wrong tool here: checks report failures as
  # WARNINGS and let the operation continue, so the apply would proceed and fail
  # somewhere less obvious.
  runtime_service_account = lookup(local.runtime_service_accounts, var.environment, "")
}


# ─────────────────────────────────────────────────────────────────────────────
# Secret Manager containers
# ─────────────────────────────────────────────────────────────────────────────
#
# Secret names include the environment so dev and prod never share a value.
#
# This is important because sharing one secret between environments would mean:
#
#   - rotating dev also rotates prod
#   - leaking dev exposes prod
#   - testing mistakes cross an environment boundary
#
# Each environment therefore gets its own secret containers.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_secret_manager_secret" "agent" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = each.value.secret_id


  # ───────────────────────────────────────────────────────────────────────────
  # Replication
  # ───────────────────────────────────────────────────────────────────────────
  #
  # Secrets are stored in the same region as the Cloud Run workload.
  #
  # This keeps secret storage aligned with the application's regional boundary
  # and avoids replicating values into regions the current architecture does not
  # use.
  #
  # Changing the replication model later may require replacement of the Secret
  # Manager resource, so this is an intentional infrastructure decision.
  # ───────────────────────────────────────────────────────────────────────────

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }


  labels = {
    app         = "mydeck"
    managed     = "terraform"
    component   = "agent"
    environment = var.environment
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Runtime service account → Secret Manager
# ─────────────────────────────────────────────────────────────────────────────
#
# The Cloud Run application reads secrets using its runtime identity:
#
#   mydeck-agent-dev
#       ↓ runs as
#   mydeck-agent-dev-runtime
#       ↓ may read
#   mydeck-agent-dev-* secrets
#
# and separately:
#
#   mydeck-agent-prod
#       ↓ runs as
#   mydeck-agent-prod-runtime
#       ↓ may read
#   mydeck-agent-prod-* secrets
#
# Access is granted PER SECRET rather than at project level.
#
# Project-level roles/secretmanager.secretAccessor would allow the application
# to read every Secret Manager secret in the project, including secrets created
# for another environment or future service.
#
# The deploy service account deliberately receives no secret access here.
#
# CI needs to build and deploy the application; it does not need to read runtime
# credentials.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_secret_manager_secret_iam_member" "runtime_reads" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.agent[each.key].secret_id

  role   = "roles/secretmanager.secretAccessor"
  member = "serviceAccount:${local.runtime_service_account}"

  # iam/ owns every runtime identity centrally, so this root depends on that
  # module having been applied for THIS environment first. Terraform orders
  # things correctly inside this root, but it has no dependency graph spanning
  # separate states — cross-root apply order is operational, not enforced. So
  # the dependency gets an error that names the fix.
  lifecycle {
    precondition {
      condition     = local.runtime_service_account != ""
      error_message = "iam/ has no runtime service account for environment '${var.environment}' (it knows about: ${join(", ", keys(local.runtime_service_accounts))}). Add '${var.environment}' to environments in iam/terraform.tfvars, apply iam/, then retry here."
    }
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Cloudflare Worker copy of AGENT_SERVICE_SECRET
# ─────────────────────────────────────────────────────────────────────────────
#
# AGENT_SERVICE_SECRET intentionally exists in two systems:
#
#   Google Secret Manager
#     → read by the Cloud Run agent service
#
#   Cloudflare Worker secret storage
#     → read by the Worker making the request
#
# The values must match because the secret proves the request came from the
# trusted Worker.
#
# Terraform manages neither secret VALUE.
#
# The Cloudflare copy is set with Wrangler:
#
#   npx wrangler secret put AGENT_SERVICE_SECRET
#
# The Google copy is added with:
#
#   gcloud secrets versions add ...
#
# Rotation therefore affects both sides.
#
# During rotation there can be a short period where the values do not match and
# the agent rejects Worker requests. Rotate deliberately and verify both sides
# before widening traffic.
#
# docs/architecture.md §10.
# ─────────────────────────────────────────────────────────────────────────────