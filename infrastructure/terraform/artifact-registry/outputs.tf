output "repository_uri" {
  description = "Repository endpoint. The push target, without an image name."
  value       = google_artifact_registry_repository.images.registry_uri
}

output "agent_image" {
  description = "Base path of the agent image. Append :<commit-sha> to tag a build."
  value       = "${google_artifact_registry_repository.images.registry_uri}/mydeck-agent"
}

output "docker_credential_host" {
  description = "Host to authenticate against: gcloud auth configure-docker <this>"

  # Split from the provider-computed URI rather than rebuilt from var.region,
  # so there is one source of truth for the path and no second place to fix if
  # the location ever changes.
  value = split("/", google_artifact_registry_repository.images.registry_uri)[0]
}

output "cleanup_armed" {
  description = "Whether cleanup policies can actually delete versions, or are only being observed."

  # The dangerous property of this module is whether it deletes images, and
  # that lives in a tfvars file this output makes unnecessary to go read.
  value = var.cleanup_dry_run ? "dry run — matching versions are logged, not deleted" : "ARMED — matching versions are deleted"
}
