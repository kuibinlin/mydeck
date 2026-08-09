# The agent service on Cloud Run — development.
#
# All the resources and the reasoning behind them live in ../modules/run:
# the ingress posture (§7.3), the image ownership split, the timeout chain and
# what it does not cover, the startup probe, and both IAM grants.
#
# What is per-root: the backend prefix, and the values below.
#
# The environment difference that matters is min_instances. Dev scales to zero
# because the only person paying a cold start is whoever is testing, and a cold
# start is ~23.6s — measured, see ../modules/run/variables.tf. Production sets
# 1, which is the first continuously billed resource in this project.

module "run" {
  source = "../modules/run"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment

  ai_provider = var.ai_provider
  ai_model    = var.ai_model
  ai_base_url = var.ai_base_url

  min_instances   = var.min_instances
  max_instances   = var.max_instances
  secret_versions = var.secret_versions
}
