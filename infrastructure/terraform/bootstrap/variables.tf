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

# ─────────────────────────────────────────────────────────────────────────────
# Budget
#
# Added when run-prod/ set min_instances = 1 — the first continuously billed
# resource in this project. Before that everything was free or scale-to-zero and
# there was nothing a runaway could run away with.
#
# The failure this guards is not a big bill. It is a bill discovered a month
# late: a scale-up that never scaled back, an uptime check misconfigured to
# probe every 60 seconds from a dozen regions, an image build loop filling
# Artifact Registry. All of them silent, all of them only visible on an invoice.
# ─────────────────────────────────────────────────────────────────────────────

variable "billing_account" {
  description = "Billing account ID that pays for this project, as XXXXXX-XXXXXX-XXXXXX. Not a secret, but not committed either — it lives in tfvars."
  type        = string

  validation {
    condition     = can(regex("^[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}$", var.billing_account))
    error_message = "billing_account is three groups of six uppercase hex characters, e.g. 01ABCD-234EFG-5678HI. `gcloud billing accounts list` prints it."
  }
}

variable "budget_amount" {
  description = "Monthly budget. Alerts fire at 50%, 90%, 100%, and when GCP forecasts the month will exceed it."
  type        = number
  default     = 50

  # A guess until there is a month of data. One warm Cloud Run instance
  # (run-prod's min_instances = 1) is the only continuous cost; Artifact
  # Registry, Secret Manager, the state bucket and monitoring are cents or free.
  #
  # Deliberately above expected rather than near it: a threshold that fires most
  # months is one nobody opens. If the 50% alert arrives every month, the budget
  # is too low — raise it rather than muting it.
  #
  # The FORECASTED threshold makes that safe to get wrong initially. It trips
  # early in a month that is trending over, so a badly chosen number shows up in
  # days rather than on an invoice.
  validation {
    condition     = var.budget_amount > 0
    error_message = "budget_amount must be positive."
  }
}

variable "budget_currency" {
  description = "Must match the billing account's own currency, or the API rejects the budget."
  type        = string
  default     = "SGD"

  # Confirmed against the account rather than assumed:
  #
  #   gcloud billing accounts describe <ID> --format='value(currencyCode)'
  #
  # It is not a preference — a mismatch is rejected, and the error names the
  # currency without explaining the rule. Defaulted to this project's actual
  # value for the same reason region defaults to asia-southeast1.
}
