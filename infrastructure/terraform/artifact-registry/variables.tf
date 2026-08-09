variable "project_id" {
  description = "Google Cloud project ID that owns the MyDeck infrastructure."
  type        = string

  # Repeated from bootstrap rather than inherited. Each root module has its own
  # tfvars, so a typo here would silently create a repository in whatever
  # project the value names — including one that is not ours.
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

# Cleanup policy.
#
# Images are tagged by commit SHA, so every merge pushes a version and nothing
# ever removes one. The policy is declared now, while the repository is empty
# and there is nothing deployed to reason about.
#
# Artifact Registry evaluates keep policies ahead of delete policies: a version
# matching both is kept. The keep count is therefore a floor, not a target.

variable "cleanup_keep_recent_count" {
  description = "Most recent versions always retained, regardless of age."
  type        = number
  default     = 20

  validation {
    condition     = var.cleanup_keep_recent_count >= 1
    error_message = "cleanup_keep_recent_count must be at least 1; a repository that keeps nothing has no rollback target."
  }
}

variable "cleanup_delete_older_than_days" {
  description = "Age at which a version becomes eligible for deletion, subject to the keep count."
  type        = number
  default     = 30

  validation {
    condition     = var.cleanup_delete_older_than_days >= 1
    error_message = "cleanup_delete_older_than_days must be at least 1."
  }
}

variable "cleanup_dry_run" {
  description = "When true, cleanup policies are evaluated and logged but delete nothing."
  type        = bool

  # Defaults to on. Artifact Registry applies policy changes asynchronously, so
  # the effect of a policy is observed in logs before it is granted the ability
  # to delete. Turning this off is a deliberate tfvars change, not a code edit.
  default = true
}
