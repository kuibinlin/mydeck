variable "project_id" {
  description = "Google Cloud project ID that owns the MyDeck infrastructure."
  type        = string

  validation {
    condition     = can(regex("^mydeck($|-)", var.project_id))
    error_message = "project_id must be 'mydeck' or start with 'mydeck-'."
  }
}

variable "region" {
  description = "Default Google Cloud region."
  type        = string
  default     = "asia-southeast1"
}

variable "environment" {
  description = "Which Cloud Run environment to watch. Only prod is worth alerting on — dev scales to zero and is meant to be broken."
  type        = string
  default     = "prod"
}

variable "alert_email" {
  description = "Where alerts go. Not committed — a personal address, and this repository is public."
  type        = string
}

# ─────────────────────────────────────────────────────────────────────────────
# Thresholds
#
# Both are derived from the timeout chain, not chosen for looking reasonable:
#
#   AGENT_DEADLINE_S          20s   the agent stops itself
#   AGENT_SERVICE_TIMEOUT_MS  25s   the Worker gives up, rethrows, and
#                                   routes/zh.js degrades to the cards
#
# A turn past 20s is one the agent could not finish. A turn past 25s is one the
# learner saw nothing for. The alert sits at the first, because by the second it
# has already cost someone their answer.
# ─────────────────────────────────────────────────────────────────────────────

variable "latency_threshold_s" {
  description = "p95 request latency that triggers an alert. Matches AGENT_DEADLINE_S."
  type        = number
  default     = 20

  validation {
    condition     = var.latency_threshold_s > 0 && var.latency_threshold_s <= 25
    error_message = "Must be positive and at most 25 — beyond the Worker's AGENT_SERVICE_TIMEOUT_MS the alert fires only after the learner has already lost the answer."
  }
}
