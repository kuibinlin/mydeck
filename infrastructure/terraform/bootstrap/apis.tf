# Google Cloud APIs required by the rest of the MyDeck infrastructure.
#
# API enablement is project-wide, so bootstrap owns it centrally rather than
# having multiple root modules manage the same shared project setting.

locals {
  services = [
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project = var.project_id
  service = each.value

  # APIs are shared project-wide capabilities. Keep them enabled even if this
  # bootstrap resource is later removed or destroyed.
  disable_on_destroy = false
}