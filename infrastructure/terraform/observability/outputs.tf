output "watching" {
  description = "Which service these alerts cover."
  value       = local.service_name
}

output "alerts" {
  description = "What fires, and what each one means."

  value = join("\n", [
    "down   — /health failing for 5m. Learners see cards with no tutor reply, not an error.",
    "errors — any 5xx. INVISIBLE in the product: the Worker falls back to its own loop.",
    "slow   — p95 over ${var.latency_threshold_s}s for 10m. The §11 step 8 question.",
  ])
}

output "step_8_caveat" {
  description = "What these alerts do NOT answer."

  # Stated as an output rather than buried in a comment, because the temptation
  # once alerts exist is to treat silence as evidence. It is not, for this
  # question.
  value = "A p95 alert catches sustained slowness, not a rare outlier — one slow turn in fifty will not move it. The precise slow-turn RATE that gates step 8 is still the count of `[agent] remote timeout` lines in the Worker's logs. Silence here means no regression, not no problem."
}
