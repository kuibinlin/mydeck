# Declared again in the root rather than only in the module, because tfvars is
# read by the root — a variable the root does not declare cannot be set in
# terraform.tfvars at all.
#
# Validation lives in ../modules/secrets/variables.tf and is not repeated here.
# One place to state a rule; the module is where a second caller would hit it.

variable "project_id" {
  description = "Google Cloud project ID that owns the MyDeck infrastructure."
  type        = string
}

variable "region" {
  description = "Region secrets are replicated to. Should match where Cloud Run runs."
  type        = string
  default     = "asia-southeast1"
}

variable "environment" {
  description = "The single environment this root owns. Must already exist in iam/'s environments."
  type        = string
}

variable "enable_tracing" {
  description = "Create the Langfuse credential pair. Off by default — an unversioned secret is a deploy failure waiting to happen."
  type        = bool
  default     = false
}
