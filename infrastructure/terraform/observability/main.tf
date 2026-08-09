# Alerts for the agent service.
#
# ─────────────────────────────────────────────────────────────────────────────
# THREE ALERTS, AND NOTHING ELSE
# ─────────────────────────────────────────────────────────────────────────────
#
# No dashboards, no log-based metrics, no error reporting. Those are the parts
# that become noise nobody reads, and this project has one user. Everything here
# answers a question that already came up:
#
#   is it up?          a scale-to-zero service that fails to start looks
#                      identical to a quiet one until someone tries to use it
#
#   is it failing?     the Worker swallows agent errors by design — a failure
#                      falls back to the JavaScript loop and the learner sees a
#                      normal answer. Cloud Run is the only place it is visible.
#
#   is it too slow?    the question gating §11 step 8
#
# That last one is the reason this module exists at all. A warm turn measured
# 29.8s where comparable turns run 2-6s (architecture.md §13). Through the
# Worker that is a 25s timeout, rethrown, degrading to the cards — the learner
# waits and gets no tutor reply. How OFTEN that happens is what decides whether
# the Python path is good enough to give everyone, and until now the only way to
# find out was reading `[agent] remote timeout` lines by hand.
#
# ─────────────────────────────────────────────────────────────────────────────
# HONEST LIMIT
# ─────────────────────────────────────────────────────────────────────────────
#
# A p95 alert catches SYSTEMATIC slowness, not a rare outlier. At this traffic
# one slow turn in fifty will not move p95, so this does not fully answer the
# step 8 question on its own — the Worker's own log lines remain the precise
# count. What it does is stop a sustained regression going unnoticed for weeks,
# which is the failure that needs a machine rather than a habit.

data "terraform_remote_state" "run" {
  backend = "gcs"

  config = {
    bucket = "mydeck-linsnotes-tfstate"
    prefix = "run-${var.environment}"
  }
}

locals {
  service_name = data.terraform_remote_state.run.outputs.service_name

  # The uptime check wants a bare host, the module publishes a URL.
  service_host = replace(data.terraform_remote_state.run.outputs.service_url, "https://", "")
}


# ─────────────────────────────────────────────────────────────────────────────
# Where alerts go
#
# Email, deliberately. Not Slack, not PagerDuty: this is a project with one
# maintainer, and a channel nobody has open is a notification that does not
# happen.
# ─────────────────────────────────────────────────────────────────────────────
resource "google_monitoring_notification_channel" "email" {
  project      = var.project_id
  display_name = "MyDeck alerts"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Is it up?
#
# /health is unauthenticated precisely so this can reach it — the shared secret
# gates /internal/agent/turn and nothing else (app/main.py).
#
# Checking every 5 minutes also keeps one instance warm as a side effect. That
# is harmless here because run-prod already sets min_instances = 1; it would be
# a real (and accidental) cost on a scale-to-zero service.
# ─────────────────────────────────────────────────────────────────────────────
resource "google_monitoring_uptime_check_config" "agent_health" {
  project      = var.project_id
  display_name = "${local.service_name} /health"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"

    labels = {
      project_id = var.project_id
      host       = local.service_host
    }
  }
}

resource "google_monitoring_alert_policy" "down" {
  project      = var.project_id
  display_name = "${local.service_name} is down"
  combiner     = "OR"

  notification_channels = [google_monitoring_notification_channel.email.id]

  conditions {
    display_name = "uptime check failing"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "resource.type=\"uptime_url\"",
        "metric.label.check_id=\"${google_monitoring_uptime_check_config.agent_health.uptime_check_id}\"",
      ])

      # Counts FAILING regions rather than averaging pass rates.
      #
      # Google probes from several locations at once. Averaging means the mean
      # drops below 1 the moment any single region fails — including a transient
      # blip between one probe and Cloudflare, with the service perfectly
      # healthy. On a solo project alerting to email, that is how the emails
      # start getting ignored, and an alert you ignore makes silence meaningless.
      #
      # More than one region failing is a real signal. One is weather.
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
      }
    }
  }

  documentation {
    content = "${local.service_name} failed its /health check. The Worker degrades to the cards when the agent is unreachable, so learners see a word card with no tutor reply rather than an error — this alert is the only thing that says so."
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Is it failing?
#
# The Worker catches every agent failure except a timeout and falls through to
# its own loop, so a 5xx here is INVISIBLE to the learner and invisible in the
# product. That is good design and it means Cloud Run's own metrics are the only
# place the failure exists.
# ─────────────────────────────────────────────────────────────────────────────
resource "google_monitoring_alert_policy" "errors" {
  project      = var.project_id
  display_name = "${local.service_name} returning 5xx"
  combiner     = "OR"

  notification_channels = [google_monitoring_notification_channel.email.id]

  conditions {
    display_name = "5xx responses"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.service_name=\"${local.service_name}\"",
        "metric.label.response_code_class=\"5xx\"",
      ])

      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  documentation {
    content = "${local.service_name} returned a 5xx. The Worker falls back to its JavaScript loop on anything but a timeout, so this is invisible to learners — check `[agent] remote fallback` in `wrangler tail` for the matching Worker-side reason."
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# Is it too slow?
#
# The §11 step 8 question. Threshold is AGENT_DEADLINE_S, not a round number:
# past 20s the agent could not finish, and past 25s the Worker has already given
# up and the learner has lost the prose.
# ─────────────────────────────────────────────────────────────────────────────
resource "google_monitoring_alert_policy" "slow" {
  project      = var.project_id
  display_name = "${local.service_name} p95 latency over ${var.latency_threshold_s}s"
  combiner     = "OR"

  notification_channels = [google_monitoring_notification_channel.email.id]

  conditions {
    display_name = "p95 request latency"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_latencies\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.service_name=\"${local.service_name}\"",
      ])

      comparison = "COMPARISON_GT"

      # Cloud Run reports latency in milliseconds.
      threshold_value = var.latency_threshold_s * 1000

      # 10 minutes, not 5. A single cold start after an idle period is not a
      # regression, and paging on one is how an alert gets muted.
      duration = "600s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_95"
      }
    }
  }

  documentation {
    content = "p95 latency on ${local.service_name} exceeded ${var.latency_threshold_s}s, which is AGENT_DEADLINE_S. Turns past that return an empty message; past the Worker's 25s they cost the learner the reply entirely. See architecture.md §13 — the suspects are the model provider and the HSK dictionary hop, and they are distinguishable by comparing a turn that uses no tool against one that does."
  }
}
