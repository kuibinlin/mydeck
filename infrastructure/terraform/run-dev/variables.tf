# Declared here so terraform.tfvars can set them — a root cannot accept a value
# for a variable it does not declare, even if the module has one.
#
# This is a SUBSET of what ../modules/run accepts. The module also takes
# bootstrap_image, agent_deadline_s, request_timeout_s, ai_temperature,
# concurrency, cpu and memory, all with defaults that have so far been right for
# both environments. Exposing one is four lines here plus one in main.tf; the
# alternative was copying sixteen declarations into every root, which is
# boilerplate that hides which knobs anyone actually turns.
#
# Validation rules stay in the module. One place to state a rule.

variable "project_id" {
  description = "Google Cloud project ID that owns the MyDeck infrastructure."
  type        = string
}

variable "region" {
  description = "Region the Cloud Run service runs in. Must match where secrets-<env>/ replicates to."
  type        = string
  default     = "asia-southeast1"
}

variable "environment" {
  description = "The single environment this root owns. Must exist in iam/'s environments and have a matching secrets-<env>/ applied."
  type        = string
}

variable "ai_provider" {
  description = "AI_PROVIDER. \"openai\" covers anything OpenAI-compatible, including SEA-LION."
  type        = string
  default     = "openai"
}

variable "ai_model" {
  description = "AI_TUTOR_MODEL — the model driving the agent loop. Must be tool-capable."
  type        = string
}

variable "ai_base_url" {
  description = "AI_BASE_URL. Host only. Empty for the provider's default."
  type        = string
  default     = ""
}

variable "min_instances" {
  description = "Warm instances. 0 for dev, 1 for prod — see the measurement in ../modules/run/variables.tf."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Ceiling on concurrent instances. A cost guard, not a capacity plan."
  type        = number
  default     = 2
}

variable "secret_versions" {
  description = "Secret Manager versions to pin, keyed by logical secret type. Unlisted secrets use \"latest\". Pin in production."
  type        = map(string)
  default     = {}
}
