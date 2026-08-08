# ─────────────────────────────────────────────────────────────────────────────
# Service accounts
# ─────────────────────────────────────────────────────────────────────────────
#
# MyDeck uses two separate Google service accounts because CI/CD and the running
# application have different responsibilities and different compromise paths.
#
# Keeping them separate limits blast radius.
#
#
# 1. Deploy service account
#
#    Used by GitHub Actions during CI/CD.
#
#    GitHub does not hold a permanent key for this account. Instead:
#
#      GitHub Actions
#          ↓
#      short-lived OIDC identity
#          ↓
#      Workload Identity Federation
#          ↓
#      temporary impersonation of this deploy service account
#
#    The service account itself is persistent, but the credentials issued to a
#    workflow are short-lived.
#
#    Its responsibilities are deployment-related:
#
#      - push container images to Artifact Registry
#      - deploy new Cloud Run revisions
#      - assign the approved runtime service account to Cloud Run
#
#
# 2. Runtime service account
#
#    This is the identity used by the Python agent container while it is running
#    on Cloud Run.
#
#    Application code uses this identity when it needs to access Google Cloud
#    resources such as Secret Manager.
#
#    Its permissions should be limited to what the running application needs,
#    for example:
#
#      - read specific runtime secrets
#      - write telemetry only if the application explicitly uses those APIs
#
#
# Why not use one service account for both?
#
# The runtime service processes user input and model output. If a vulnerability
# gives an attacker code execution inside the container, the attacker may gain
# access to whatever permissions the runtime identity has.
#
# With separate identities:
#
#      container compromise
#          ↓
#      runtime service account
#          ↓
#      may access only runtime resources
#
#      ✗ cannot push container images
#      ✗ cannot deploy new Cloud Run revisions
#
# If the same account were used for runtime and deployment, a compromise of the
# application could also expose CI/CD deployment permissions.
#
# Neither service account has a downloadable service account key.
#
# The deploy account is accessed through Workload Identity Federation.
# The runtime account is attached directly to the Cloud Run service.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "mydeck-deploy"
  display_name = "MyDeck CI deploy"

  description = "CI/CD identity impersonated by GitHub Actions through Workload Identity Federation. Pushes images and deploys Cloud Run revisions. No service account key."
}

# One runtime identity per environment, never one shared between them.
#
#   mydeck-agent-dev-runtime    runs mydeck-agent-dev
#   mydeck-agent-prod-runtime   runs mydeck-agent-prod
#
# The name extends the Cloud Run service name from §12 rather than inventing a
# separate shape, so a search for "mydeck-agent-dev" finds the service and the
# identity it runs as together.
#
# Sharing one account across environments would make dev and prod the same IAM
# principal, and secrets/ could no longer keep prod secrets out of dev's reach.
# See the reasoning on var.environments.
#
# account_id cannot be changed after creation. Renaming one of these later means
# creating a new account, re-granting every permission, redeploying the service
# to switch identity, and deleting the old one — so the name is settled here,
# before the first apply, rather than adjusted afterwards.
resource "google_service_account" "runtime" {
  for_each = var.environments

  project      = var.project_id
  account_id   = "mydeck-agent-${each.key}-runtime"
  display_name = "MyDeck agent runtime (${each.key})"

  description = "Runtime identity for the mydeck-agent-${each.key} Cloud Run service. Granted only what that environment's application needs. No service account key."
}