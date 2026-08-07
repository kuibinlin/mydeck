# Docker repository for MyDeck container images.
#
# The repository name is a cross-document contract, not a local choice. It is
# one segment of the image path pinned in docs/architecture.md §12:
#
#   asia-southeast1-docker.pkg.dev/mydeck-linsnotes/mydeck-images/mydeck-agent:<sha>
#   └─ location ──┘                └─ project ───┘ └─ this repo ┘ └─ image ──┘
#
# The repository holds images; mydeck-agent is one image inside it. Renaming
# either half means editing every runbook and CI file that names the path.

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "mydeck-images"
  format        = "DOCKER"
  description   = "MyDeck container images. Tagged by commit SHA."

  # Cleanup policy.
  #
  # Images are tagged by commit SHA, so every merge pushes a version that
  # nothing else will ever overwrite or remove.
  #
  # Artifact Registry evaluates KEEP ahead of DELETE: a version matching both
  # policies below is kept. keep-recent is therefore a floor under delete-old,
  # not a competing rule.
  #
  # Declared in dry run first. Artifact Registry applies policy changes
  # asynchronously, so what these rules actually match is read out of the
  # cleanup logs before they are allowed to delete anything.
  cleanup_policy_dry_run = var.cleanup_dry_run

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = var.cleanup_keep_recent_count
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"

    condition {
      # Seconds, because that is the form the API stores and returns. Writing
      # "30d" here would read back as "2592000s" and plan a change forever.
      older_than = "${var.cleanup_delete_older_than_days * 86400}s"

      # ANY, not UNTAGGED. SHA tags are never reused, so a version only becomes
      # untagged if someone deletes the tag by hand — restricting to UNTAGGED
      # would make this rule match approximately nothing.
      tag_state = "ANY"
    }
  }

  # deletion_policy is left at its "DELETE" default rather than "PREVENT".
  # infrastructure/README.md destroys this module normally, ahead of bootstrap;
  # only the state bucket is deliberately hard to remove. Note that destroying
  # the repository destroys the images in it.

  labels = {
    app       = "mydeck"
    managed   = "terraform"
    component = "images"
  }
}
