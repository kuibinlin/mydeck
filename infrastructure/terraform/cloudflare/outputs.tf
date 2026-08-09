output "zone_id" {
  description = "Resolved from zone_name. Needed for any DNS work in the second pass."
  value       = data.cloudflare_zone.main.zone_id
}

output "d1_database_id" {
  description = "Must match database_id in backend/wrangler.toml — the Worker binds by ID."

  # The one cross-check worth having. Terraform owns the database; wrangler.toml
  # owns the binding, by hand. If these two ever disagree, the Worker is talking
  # to a database Terraform does not manage, or to nothing at all.
  value = cloudflare_d1_database.main.id
}

output "kv_namespace_id" {
  description = "Must match id in backend/wrangler.toml's [[kv_namespaces]] block."
  value       = cloudflare_workers_kv_namespace.sessions.id
}

output "binding_check" {
  description = "Run this to confirm wrangler.toml still points at what Terraform manages."

  value = join("\n", [
    "grep -E 'database_id|^id' ../../../backend/wrangler.toml",
    "# expect d1: ${cloudflare_d1_database.main.id}",
    "# expect kv: ${cloudflare_workers_kv_namespace.sessions.id}",
  ])
}
