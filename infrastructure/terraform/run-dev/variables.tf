variable "project_id" {
  description = "Google Cloud project ID that owns the MyDeck infrastructure."
  type        = string

  validation {
    condition     = can(regex("^mydeck($|-)", var.project_id))
    error_message = "project_id must be 'mydeck' or start with 'mydeck-'. Relax this validation deliberately if a different project naming scheme is intended."
  }
}

variable "region" {
  description = "Region the Cloud Run service runs in. Must match the region secrets-dev/ replicates to."
  type        = string
  default     = "asia-southeast1"
}

variable "environment" {
  description = "Single environment owned by this Terraform root. Must already exist in iam/ and have a matching secrets-<env>/ root applied."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,8}$", var.environment))
    error_message = "environment must start with a lowercase letter, contain only lowercase letters, digits or hyphens, and be at most 9 characters."
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# The image, and who owns it
# ─────────────────────────────────────────────────────────────────────────────
#
# Terraform owns the service SHAPE. CI owns which image SHA is running. That
# split is docs/architecture.md §9, and it is the same division the repository
# already makes on Cloudflare, where Terraform owns D1 and KV while Wrangler
# owns the Worker script.
#
#   Terraform   CPU, memory, concurrency, ingress, timeout, scaling,
#               runtime identity, env vars, secret mounts
#
#   CI          gcloud run deploy --image ...:<sha>
#
# service.tf therefore ignores changes to the image. The value below is read
# ONLY when the service is first created, and never again.
#
# It deliberately stays a placeholder rather than a real mydeck-agent SHA. A
# real-looking tag here would be permanently stale AND permanently misleading —
# someone reads it in six months and reasonably concludes it is what is serving.
# "gcr.io/cloudrun/hello" is self-evidently not this application, which tells the
# reader the field is not the source of truth.
#
# What IS running:
#
#   gcloud run services describe mydeck-agent-dev --region=asia-southeast1 \
#     --format='value(spec.template.spec.containers[0].image)'
# ─────────────────────────────────────────────────────────────────────────────

variable "bootstrap_image" {
  description = "Image used ONLY at first create. Cloud Run requires one; Terraform does not own this field afterwards. The running image is whatever CI last deployed."
  type        = string
  default     = "gcr.io/cloudrun/hello"
}


# ─────────────────────────────────────────────────────────────────────────────
# The timeout chain
# ─────────────────────────────────────────────────────────────────────────────
#
# Three timeouts across two repositories, and they must stay ordered:
#
#   AGENT_DEADLINE_S            20s   the agent stops ITSELF here
#         <
#   Cloud Run request timeout   30s   backstop if the agent does not
#         >
#   AGENT_SERVICE_TIMEOUT_MS    25s   the Worker stops waiting (backend/)
#
# The agent stopping first is the point: it returns stopped_by="step_limit"
# rather than an error, because the Worker answers a fast failure by running its
# own loop, and a turn that was already too slow must not cost the learner a
# second wait. Without the deadline the container works on past everyone's
# patience, spending model budget on a request nobody will read.
#
# Cloud Run's timeout is only the backstop for a genuinely stuck request. It sits
# ABOVE the agent deadline so that a normal slow turn is ended by the agent's own
# clean stop, not by the platform killing the connection.
#
# AGENT_SERVICE_TIMEOUT_MS lives in backend/wrangler.toml and is not managed
# here. If you change one of these, check all three.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS CHAIN DOES NOT COVER: COLD START
# ─────────────────────────────────────────────────────────────────────────────
#
# All three timeouts bound AGENT WORK. None of them bounds container boot.
#
# Cloud Run holds the request while the container starts, so the agent's clock
# begins only once the handler runs. Measured 2026-08-09, a cold turn took
# 23,626 ms end to end and still reported stopped_by "answered" — from inside
# the agent it was a ~5s turn, because the other ~17.8s was Python starting and
# LangChain importing, before the deadline had anything to measure.
#
# So the only limit a cold start can breach is the Worker's, and it came within
# 1.4s of doing so. AGENT_DEADLINE_S cannot help; a warm instance can, which is
# why var.min_instances exists and why production sets it to 1.
# ─────────────────────────────────────────────────────────────────────────────

variable "agent_deadline_s" {
  description = "AGENT_DEADLINE_S for the container — when the agent stops itself. Must stay below request_timeout_s."
  type        = number
  default     = 20

  validation {
    condition     = var.agent_deadline_s > 0
    error_message = "agent_deadline_s must be positive."
  }
}

variable "request_timeout_s" {
  description = "Cloud Run request timeout. A backstop above agent_deadline_s, not the primary limit."
  type        = number
  default     = 30

  validation {
    condition     = var.request_timeout_s > var.agent_deadline_s
    error_message = "request_timeout_s must exceed agent_deadline_s. Otherwise Cloud Run kills the connection before the agent can stop itself and return a partial answer, turning a graceful stop into a transport failure."
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Model configuration — not secrets
# ─────────────────────────────────────────────────────────────────────────────
#
# app/config.py reads these as plain environment variables. Only AI_API_KEY is
# a secret, and it arrives from Secret Manager (secrets-dev/).
#
# These are deliberately allowed to differ from the Worker's AI_MODEL and
# AI_TUTOR_MODEL. §8.4: the two paths are PERMITTED to diverge, and the
# divergence should be deliberate and documented rather than accidental.
# ─────────────────────────────────────────────────────────────────────────────

variable "ai_provider" {
  description = "AI_PROVIDER. \"openai\" covers anything OpenAI-compatible, including SEA-LION."
  type        = string
  default     = "openai"
}

variable "ai_model" {
  description = "AI_TUTOR_MODEL — the model driving the agent loop. Must be tool-capable; a model that cannot do tools does not always say so."
  type        = string
}

variable "ai_base_url" {
  description = "AI_BASE_URL. Host only — the client appends the path. Empty for the provider's default."
  type        = string
  default     = ""
}

variable "ai_temperature" {
  description = "AI_TEMPERATURE."
  type        = number
  default     = 0.3
}


# ─────────────────────────────────────────────────────────────────────────────
# Capacity
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Secret versions
# ─────────────────────────────────────────────────────────────────────────────
#
# Keys are the logical secret types from secrets-<env>/ ("ai-api-key",
# "service-secret"); values are Secret Manager version numbers. Anything not
# listed resolves to "latest".
#
# Google recommends pinning a version when secrets are exposed as environment
# variables, and the reason is specific: env-var secrets resolve when an
# INSTANCE starts, not when a revision is created. So under "latest", adding a
# new version means instances of the SAME revision can be serving different
# values — the ones that started before the rotation hold the old one until
# they are recycled. There is no moment where the revision flips.
#
#   dev    "latest" is fine. Rotation is a restart, the blast radius is you,
#          and not having to run Terraform to rotate is worth more here.
#
#   prod   pin. Rotation becomes deliberate and reversible:
#             add version 2 → test → change this map 1 → 2 → new revision
#             → rollback by reverting the map
#
# Pinning also makes the running configuration answerable from the repository
# rather than from whatever Secret Manager currently calls "latest".
# ─────────────────────────────────────────────────────────────────────────────

variable "secret_versions" {
  description = "Secret Manager versions to pin, keyed by logical secret type. Unlisted secrets use \"latest\". Pin in production."
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for v in values(var.secret_versions) : can(regex("^([0-9]+|latest)$", v))])
    error_message = "Each secret version must be a version number such as \"2\", or the literal \"latest\"."
  }
}


variable "min_instances" {
  description = "Warm instances. 0 for dev — an idle service should cost nothing."
  type        = number
  default     = 0

  # PRODUCTION SHOULD SET 1, and this is now measured rather than assumed.
  #
  # Shadow mode, 2026-08-09, remoteMs at the Worker:
  #
  #   cold   23,626 ms   create_activity, 2 model calls
  #   warm    5,800 ms   create_activity, 2 model calls   ← identical work
  #   warm    1,776 ms   no tools
  #
  # ~17.8s of that is Python starting and LangChain importing, against an
  # AGENT_SERVICE_TIMEOUT_MS of 25s. A 1.4s margin, and a Worker timeout is
  # rethrown rather than retried — routes/zh.js degrades to the cards and the
  # learner loses the prose.
  #
  # Raising the Worker timeout is not the alternative: the free Workers plan
  # caps a request at 30s wall clock (architecture.md §2), so 25s is already
  # most of the budget.
  #
  # 0 stays right for dev, where the only person paying the cold start is
  # whoever is testing. It is the main cost difference between the environments:
  # a warm instance bills continuously, an idle one bills nothing.
  #
  # Note what 1 does NOT do: it removes scale-to-zero cold starts only. With
  # concurrency = 10, the 11th simultaneous request still starts a second
  # container and pays the boot.
}

variable "max_instances" {
  description = "Ceiling on concurrent instances. A cost guard, not a capacity plan."
  type        = number
  default     = 2

  validation {
    condition     = var.max_instances >= 1
    error_message = "max_instances must be at least 1."
  }
}

variable "concurrency" {
  description = "Requests per instance. The loop is IO-bound on model calls, but each in-flight turn holds a LangChain graph in memory."
  type        = number
  default     = 10
}

variable "cpu" {
  description = "CPU limit per instance."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit per instance. LangChain's import graph is large; below 512Mi the container will not start."
  type        = string
  default     = "1Gi"
}
