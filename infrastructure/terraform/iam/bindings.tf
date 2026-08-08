# ─────────────────────────────────────────────────────────────────────────────
# IAM role grants
# ─────────────────────────────────────────────────────────────────────────────
#
# Ownership rule
# ──────────────
#
# This iam/ module creates the identities and grants permissions only where the
# target resource already exists and the scope is clear.
#
# Each resource-owning Terraform module grants access to the resources it owns.
#
# Therefore:
#
#   iam/
#     → creates deploy and runtime service accounts
#     → creates the GitHub → deploy-SA trust relationship
#     → grants access to the existing Artifact Registry repository
#     → lets the deploy SA assign the runtime SA to Cloud Run
#
#   run-dev/
#     → grants the deploy SA permission on the Cloud Run service it creates
#
#   secrets/
#     → grants the runtime SA access to each secret it creates
#
# This keeps IAM permissions close to the resource being protected and avoids
# widening permissions to the whole project just because a resource does not
# exist yet.
#
#
# IAM resource type
# ─────────────────
#
# Grants below use *_iam_member rather than *_iam_binding.
#
# *_iam_member is additive:
#
#   "Ensure this one principal has this one role."
#
# *_iam_binding is authoritative for all members of a role on that resource:
#
#   "These are the complete members of this role."
#
# Using an authoritative binding carelessly can remove other principals that
# already have the same role.
#
# For this project, additive *_iam_member resources give each Terraform
# resource ownership of exactly one grant.
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# GitHub Actions → deploy service account
# ─────────────────────────────────────────────────────────────────────────────
#
# There are two separate security checks in the WIF design:
#
#   1. workload-identity.tf
#      "May this GitHub workflow federate through this provider?"
#
#      Restricted to:
#
#        github_owner/github_repository
#
#
#   2. this IAM binding
#      "May this federated identity impersonate the deploy service account?"
#
#      Restricted further to:
#
#        github_owner/github_repository@deploy_ref
#
# Example:
#
#   kuibinlin/mydeck@refs/heads/main
#
# This means workflows from other branches in the trusted repository may still
# obtain a WIF identity for future read-only use cases, but they cannot
# impersonate the deploy service account.
#
# Deployment authorization therefore lives in Google IAM rather than depending
# only on an `if:` condition inside GitHub Actions.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_service_account_iam_member" "deploy_from_github" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"

  member = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_ref/${local.repository_ref}"
}


# ─────────────────────────────────────────────────────────────────────────────
# Deploy service account → Artifact Registry
# ─────────────────────────────────────────────────────────────────────────────
#
# GitHub Actions builds the MyDeck agent image and pushes it to Artifact
# Registry before deploying it to Cloud Run.
#
# The deploy service account therefore needs:
#
#   roles/artifactregistry.writer
#
# The grant is scoped to one repository:
#
#   mydeck-images
#
# rather than the whole project.
#
# Project-level artifactregistry.writer would also grant write access to any
# Artifact Registry repositories created in this project later.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_artifact_registry_repository_iam_member" "deploy_pushes_images" {
  project    = var.project_id
  location   = var.region
  repository = var.artifact_repository_id

  role   = "roles/artifactregistry.writer"
  member = "serviceAccount:${google_service_account.deploy.email}"
}


# ─────────────────────────────────────────────────────────────────────────────
# Deploy service account → runtime service account
# ─────────────────────────────────────────────────────────────────────────────
#
# Each Cloud Run service runs as its own environment's runtime account:
#
#   mydeck-agent-dev    runs as   mydeck-agent-dev-runtime
#   mydeck-agent-prod   runs as   mydeck-agent-prod-runtime
#
# so this grant is created once per runtime account. One deploy identity may act
# as several runtime identities; that is fine, and is the reason deployment
# authority is restricted by ref (above) rather than by environment.
#
# During deployment, GitHub Actions acts as the deploy service account and asks
# Google Cloud to configure Cloud Run to use that runtime identity.
#
# Google requires the deploy identity to have:
#
#   roles/iam.serviceAccountUser
#
# on the runtime service account.
#
# Think of this permission as:
#
#   "The deploy SA may configure an approved service to run as this SA."
#
# It does NOT mean:
#
#   "The deploy SA permanently becomes the runtime SA."
#
# This permission is commonly called the `actAs` permission.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_service_account_iam_member" "deploy_acts_as_runtime" {
  # Iterates the runtime accounts themselves rather than var.environments, so a
  # new environment cannot produce an account without this grant.
  for_each = google_service_account.runtime

  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}


# ─────────────────────────────────────────────────────────────────────────────
# Runtime service account → application permissions
# ─────────────────────────────────────────────────────────────────────────────
#
# The runtime service account is the identity available to the Python agent
# while the container is running.
#
# Runtime permissions should be granted only when the application itself needs
# them.
#
# For example:
#
#   secrets/
#     → runtime SA receives secretAccessor on specific secrets
#
# Do NOT grant Artifact Registry reader here merely because the container image
# came from Artifact Registry.
#
# Cloud Run pulls the image before starting the application. The running
# application identity does not normally need registry access.
#
#
# Logging / Monitoring note
# ─────────────────────────
#
# Normal container stdout/stderr logs are collected by Cloud Run automatically.
#
# Therefore, do not grant:
#
#   roles/logging.logWriter
#
# merely so application logs appear in Cloud Logging.
#
# Likewise, only grant:
#
#   roles/monitoring.metricWriter
#
# if the application explicitly calls the Cloud Monitoring API to write custom
# metrics.
#
# If the application later uses Google client libraries to write logs or custom
# metrics directly, add the corresponding grants deliberately at that time.
# ─────────────────────────────────────────────────────────────────────────────


# Optional example — keep ONLY if the application explicitly writes directly
# to the Cloud Logging API.
#
# resource "google_project_iam_member" "runtime_writes_logs" {
#   project = var.project_id
#   role    = "roles/logging.logWriter"
#   member  = "serviceAccount:${google_service_account.runtime.email}"
# }


# Optional example — keep ONLY if the application explicitly writes custom
# metrics through the Cloud Monitoring API.
#
# resource "google_project_iam_member" "runtime_writes_metrics" {
#   project = var.project_id
#   role    = "roles/monitoring.metricWriter"
#   member  = "serviceAccount:${google_service_account.runtime.email}"
# }


# ─────────────────────────────────────────────────────────────────────────────
# Deliberately NOT granted in iam/
# ─────────────────────────────────────────────────────────────────────────────
#
# run-dev/
# ────────
#
# The deploy service account still needs permission to deploy the Cloud Run
# service.
#
# Intended grant:
#
#   deploy SA
#       ↓
#   roles/run.developer
#       ↓
#   MyDeck Cloud Run service
#
# This grant belongs in run-dev/ because that module creates the Cloud Run
# service.
#
# The service does not exist yet while iam/ is being created, so iam/ cannot
# scope a grant to it.
#
# Granting run.developer at project level here would work technically, but would
# allow the deploy SA to modify other Cloud Run services created in the project
# later.
#
# The intended ownership remains:
#
#   Terraform
#     → owns Cloud Run service configuration
#
#   GitHub Actions
#     → owns application image deployment
#
# Therefore CI needs run.developer rather than the broader run.admin role.
#
#
# secrets/
# ────────
#
# The runtime service account will need:
#
#   roles/secretmanager.secretAccessor
#
# but only on the individual secrets required by the application.
#
# Example:
#
#   runtime SA
#       ↓
#   secretAccessor
#       ↓
#   specific MyDeck agent secret
#
# A project-level secretAccessor role would allow the running container to read
# every Secret Manager secret currently in the project and any added later.
#
# Because secrets/ owns the Secret Manager resources, it should also own these
# per-secret IAM grants.
#
#
# Summary
# ───────
#
# iam/
#   GitHub identity → deploy SA
#   deploy SA       → Artifact Registry repository
#   deploy SA       → actAs runtime SA
#
# run-dev/
#   deploy SA       → Cloud Run service
#
# secrets/
#   runtime SA      → individual secrets
#
# This keeps permissions resource-scoped and keeps each Terraform module
# responsible for access to the resources it creates.
# ─────────────────────────────────────────────────────────────────────────────