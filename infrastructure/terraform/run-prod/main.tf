# The agent service on Cloud Run — PRODUCTION.
#
# Identical code to run-dev/, from ../modules/run. Two values differ, and both
# are deliberate:
#
#   min_instances = 1     dev scales to zero; this does not
#   secret_versions       dev tracks "latest"; production pins
#
# Everything else — ingress posture (§7.3), the image ownership split, the
# timeout chain, the startup probe, both IAM grants — is shared, which is the
# point of the module. A rule added there cannot be silently absent here.

module "run" {
  source = "../modules/run"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment

  ai_provider = var.ai_provider
  ai_model    = var.ai_model
  ai_base_url = var.ai_base_url

  # ───────────────────────────────────────────────────────────────────────────
  # THE ONE THAT COSTS MONEY
  # ───────────────────────────────────────────────────────────────────────────
  #
  # A cold turn measured 23,626 ms against a 25s Worker timeout — 1.4s of
  # margin, and a Worker timeout is rethrown rather than retried, so
  # routes/zh.js degrades to the cards and the learner loses the prose entirely.
  # ~17.8s of that is Python starting and LangChain importing, and
  # AGENT_DEADLINE_S cannot bound it: Cloud Run holds the request while the
  # container boots, so the agent's clock starts after the cost is paid.
  #
  # Acceptable when the only person waiting is whoever is testing. Not
  # acceptable for a learner, which is why this is 1 and dev is 0.
  #
  # This is the first continuously billed resource in the project. It removes
  # scale-to-zero cold starts only: at concurrency 10, request 11 still starts a
  # second container and pays the boot.
  min_instances = var.min_instances
  max_instances = var.max_instances

  # Pinned rather than "latest".
  #
  # Env-var secrets resolve when an INSTANCE starts, so under "latest" a
  # rotation leaves instances of the same revision holding different values
  # until the old ones recycle. Pinning makes rotation a deliberate new revision
  # and a rollback a revert of this map. Dev keeps "latest" because rotation
  # there is a restart and the blast radius is one tester.
  secret_versions = var.secret_versions
}
