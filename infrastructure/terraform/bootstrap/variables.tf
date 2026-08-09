variable "project_id" {
  description = "Google Cloud project ID that owns the MyDeck infrastructure."
  type        = string

  validation {
    condition     = can(regex("^mydeck($|-)", var.project_id))
    error_message = "project_id must be 'mydeck' or start with 'mydeck-'. Relax this validation deliberately if a different project naming scheme is intended."
  }
}

variable "region" {
  description = "Default region. asia-southeast1 is closest to the learners this serves."
  type        = string
  default     = "asia-southeast1"
}