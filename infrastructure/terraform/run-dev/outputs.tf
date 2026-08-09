# Passed straight through from the module. The descriptions and the reasoning —
# why deployed_image says in its own value that it is not what is running, why
# smoke_test asserts on /version rather than only /health — live in
# ../modules/run/outputs.tf.

output "service_name" {
  description = "Cloud Run service name. The target for `gcloud run deploy`."
  value       = module.run.service_name
}

output "service_url" {
  description = "The service's *.run.app URL. Goes into the Worker's AGENT_SERVICE_URL."
  value       = module.run.service_url
}

output "runtime_service_account" {
  description = "The identity this service runs as."
  value       = module.run.runtime_service_account
}

output "deployed_image" {
  description = "The image in Terraform state — NOT necessarily what is serving."
  value       = module.run.deployed_image
}

output "running_image_cmd" {
  description = "Command that reports the image actually serving traffic."
  value       = module.run.running_image_cmd
}

output "smoke_test" {
  description = "Post-deploy checks. Read with `terraform output -raw smoke_test`."
  value       = module.run.smoke_test
}

output "next_steps" {
  description = "What still has to happen before this service answers a learner."
  value       = module.run.next_steps
}
