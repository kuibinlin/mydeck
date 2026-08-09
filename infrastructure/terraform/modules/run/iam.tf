# Access to the Cloud Run service.
#
# Both bindings live here rather than in iam/ for the same reason: they scope to
# a service that only exists once this module has created it. iam/ owns
# identities; each resource module grants access to the resources it owns.

# ─────────────────────────────────────────────────────────────────────────────
# CI may deploy revisions
# ─────────────────────────────────────────────────────────────────────────────
#
# roles/run.developer, not roles/run.admin. With Terraform owning the service
# shape and CI owning only the image tag, shipping a revision is the whole job —
# run.admin would additionally let CI change ingress, scaling, the runtime
# identity, and this IAM policy itself.
#
# Scoped to this one service, not the project, so a second Cloud Run service
# added later is not automatically deployable by this account.
#
# This grant completes the chain that iam/ started. The deploy account already
# has artifactregistry.writer to push the image and serviceAccountUser on the
# runtime account to assign it; this is the missing third piece that makes
# `gcloud run deploy` actually work.
resource "google_cloud_run_v2_service_iam_member" "deploy_can_deploy" {
  project  = var.project_id
  location = google_cloud_run_v2_service.agent.location
  name     = google_cloud_run_v2_service.agent.name

  role   = "roles/run.developer"
  member = "serviceAccount:${local.deploy_service_account}"
}


# ─────────────────────────────────────────────────────────────────────────────
# ANYONE MAY INVOKE — read §7.3 before changing this
# ─────────────────────────────────────────────────────────────────────────────
#
# Granting run.invoker to allUsers means Cloud Run performs NO caller
# authentication. Be precise about what that moves:
#
#   Cloud Run IAM   → does not authenticate the caller
#   app/main.py     → IS the authentication boundary
#
# That boundary is real and checked: require_secret compares the
# X-MyDeck-Agent-Secret header against AGENT_SERVICE_SECRET with
# hmac.compare_digest, 401s a mismatch, and 503s when the secret is unset while
# K_SERVICE is present — so an unconfigured deployment refuses to serve rather
# than serving to everyone. /health and /version are open on purpose; the turn
# endpoint carries Depends(require_secret).
#
# Why not IAM auth: the Worker integration has no configured keyless Google
# identity flow, and the alternative was storing a long-lived Google service
# account key in Cloudflare — the exact credential the WIF setup in iam/ exists
# to avoid. A keyless integration is buildable and can be evaluated later; §7.3
# has the detail. v1 chose the application-layer secret because it is already
# written, tested and rotatable, not because nothing else was possible.
#
# What this deliberately does NOT rely on:
#
#   - the URL being hard to guess. It is not a secret, and nothing here depends
#     on people not knowing it.
#   - Cloudflare in front. A proxied custom domain applies the WAF only to
#     traffic routed through it; the default *.run.app endpoint remains directly
#     reachable, so WAF and rate limits are bypassable for as long as it exists.
#
# Restricting ingress to a Google external load balancer is what actually closes
# that, and it is a run-prod/ decision (§13). Until then, AGENT_SERVICE_SECRET
# is the authorization control — which is why docs/secrets.md insists it be
# generated with `openssl rand -hex 32` rather than chosen.
resource "google_cloud_run_v2_service_iam_member" "public_invoke" {
  project  = var.project_id
  location = google_cloud_run_v2_service.agent.location
  name     = google_cloud_run_v2_service.agent.name

  role   = "roles/run.invoker"
  member = "allUsers"
}
