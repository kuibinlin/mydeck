variable "account_id" {
  description = "Cloudflare account ID. An identifier, not a secret — `wrangler whoami` prints it."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id is a 32-character hex string. A zone ID looks identical and is not interchangeable — check you took the ACCOUNT id."
  }
}

variable "zone_name" {
  description = "The domain, used to look the zone up by name rather than pinning an ID."
  type        = string
  default     = "linsnotes.com"

  # A name rather than a zone_id because the name is the thing a human can
  # verify at a glance. data.cloudflare_zone resolves it, and a typo fails at
  # plan time with "zone not found" instead of silently managing someone else's.
}

variable "d1_database_name" {
  description = "D1 database name. Must match database_name in backend/wrangler.toml — the Worker binds by name."
  type        = string
  default     = "linsnotes-db"
}

variable "kv_namespace_title" {
  description = "KV namespace title. The Worker binds by ID, so this is the human label only."
  type        = string

  # linsnotes-, not mydeck-. This defaulted to "mydeck-sessions" on the guess
  # that it matched the app; the first plan after import proposed renaming the
  # live namespace to match, which is exactly the kind of change adoption is
  # supposed to catch rather than perform.
  default = "linsnotes-sessions"
}

variable "pages_project_name" {
  description = "Cloudflare Pages project name, as it appears in the dashboard."
  type        = string
}
