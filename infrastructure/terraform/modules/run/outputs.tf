output "service_name" {
  description = "Cloud Run service name. The target for `gcloud run deploy` in CI."
  value       = google_cloud_run_v2_service.agent.name
}

output "service_url" {
  description = "The service's *.run.app URL. Goes into the Worker's AGENT_SERVICE_URL."

  # Not a secret, and nothing is designed as though it were. This endpoint is
  # internet-reachable and stays reachable even once a Cloudflare custom domain
  # fronts it, so anyone holding the URL bypasses the WAF. AGENT_SERVICE_SECRET
  # is the control; see iam.tf.
  value = google_cloud_run_v2_service.agent.uri
}

output "runtime_service_account" {
  description = "The identity this service runs as. Whatever it can read, an attacker with code execution in the container can read."
  value       = local.runtime_service_account
}

output "deployed_image" {
  description = "The image in Terraform state — NOT necessarily what is serving."

  # Terraform ignores changes to this field, so state holds whatever was set at
  # create time and never updates. Reading it as "what is running" is the
  # specific mistake ignore_changes invites, so the output says so rather than
  # letting the value imply otherwise.
  value = "${google_cloud_run_v2_service.agent.template[0].containers[0].image} — recorded at create time only. CI owns the running image; read it with `terraform output -raw running_image_cmd`."
}

output "running_image_cmd" {
  description = "Command that reports the image actually serving traffic."

  value = "gcloud run services describe ${google_cloud_run_v2_service.agent.name} --region=${var.region} --project=${var.project_id} --format='value(spec.template.spec.containers[0].image)'"
}

output "smoke_test" {
  description = "Post-deploy checks. /health proves it is up; /version proves WHICH build is up."

  # A deploy that silently rolled back still answers /health. Only /version
  # distinguishes the build that is serving from the one you thought you
  # shipped — the same reasoning as .github/workflows/README.md.
  value = join("\n", [
    "curl -fsS ${google_cloud_run_v2_service.agent.uri}/health",
    "curl -fsS ${google_cloud_run_v2_service.agent.uri}/version",
  ])
}

output "next_steps" {
  description = "What still has to happen before this service answers a learner."

  # The service existing changes nothing on its own: every flag ships off and
  # the JavaScript tutor stays authoritative until §11 step 8.
  value = join("\n", [
    "1. Push an image:  gcloud run deploy ${google_cloud_run_v2_service.agent.name} --image <registry>/mydeck-agent:<sha> --region ${var.region}",
    "2. Worker vars:    AGENT_SERVICE_URL = ${google_cloud_run_v2_service.agent.uri}",
    "3. Worker secret:  wrangler secret put AGENT_SERVICE_SECRET  (same value as Secret Manager — docs/secrets.md)",
    "4. Then §11 step 6 (shadow), 7 (your account only), 8 (authoritative).",
  ])
}
