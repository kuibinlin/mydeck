# A monthly budget with alerts.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT A BUDGET IS AND IS NOT
# ─────────────────────────────────────────────────────────────────────────────
#
# It does NOT cap spending. Nothing here stops a charge; GCP has no hard stop
# short of detaching billing, which would take the project down. This sends
# email when spend crosses a line.
#
# That is the right tool for the actual risk, which is not a big bill — it is a
# bill discovered a month late. Every cost failure this project could have is
# silent: a Cloud Run scale-up that never scaled back, an uptime check probing
# every 60 seconds from a dozen regions, a build loop filling Artifact Registry.
# None of them shows up anywhere you look until an invoice arrives.
#
# Same argument as observability/. A failure nobody can see needs a machine
# watching, not a habit.

# The budget filter wants a project NUMBER, not the ID. Read rather than
# hardcoded: the number is assigned by Google and nobody remembers it.
data "google_project" "this" {
  project_id = var.project_id
}

resource "google_billing_budget" "project" {
  billing_account = var.billing_account
  display_name    = "MyDeck — ${var.project_id}"

  # Scoped to this project alone. A billing account may pay for others, and a
  # budget that quietly counted their spend would fire for reasons nothing in
  # this repository could explain.
  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]

    # ─────────────────────────────────────────────────────────────────────────
    # GROSS spend, before credits. Set explicitly because the provider's default
    # is the opposite and it would quietly defeat the purpose.
    #
    # INCLUDE_ALL_CREDITS measures what you actually PAY. Under free-tier or
    # promotional credits, a runaway burns through them showing 0 spend — the
    # budget stays silent, and the first signal is credits running out and the
    # bill appearing. That is exactly the "discovered a month late" failure this
    # resource exists to prevent.
    #
    # EXCLUDE_ALL_CREDITS measures what you USE, so a runaway trips the alert
    # regardless of what is absorbing the cost. The trade is that it can alert
    # for money you are not being charged; that is the right way round for a
    # detector.
    # ─────────────────────────────────────────────────────────────────────────
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.budget_amount)
    }
  }

  # ───────────────────────────────────────────────────────────────────────────
  # Four thresholds, and the last is the one that earns its place.
  #
  # The three actual-spend rules tell you where the month has got to. Useful,
  # but they are always late: by the time actual spend hits 100% the money is
  # already gone.
  #
  # FORECASTED_SPEND is the early warning. GCP projects the month's total from
  # the run rate so far, so a service that started burning on the 3rd trips it
  # around the 5th rather than on the 28th. That is the difference between
  # noticing a runaway and reading about it.
  # ───────────────────────────────────────────────────────────────────────────

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  # No all_updates_rule, deliberately.
  #
  # Without one, alerts go to the billing account's admins — which is you, on an
  # address Google already has. Wiring it to observability/'s notification
  # channel instead would make bootstrap depend on a module that is created six
  # steps LATER, inverting the creation order for no gain.
}
