# DNS — two records out of eighteen.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY ONLY TWO
# ─────────────────────────────────────────────────────────────────────────────
#
# Terraform manages one record per resource. A record not declared here is
# invisible to it — no drift, no plan, no deletion. The other sixteen in this
# zone stay exactly as they are and Terraform will never know they exist.
#
# That is the whole reason to stay narrow. An adopted record is a record an edit
# can delete: remove the block and `apply` removes it from DNS. Two records
# under management is two ways to break something; eighteen is eighteen, for no
# benefit, since the rest belong to email, site verification, and services this
# app does not own.
#
# Deliberately NOT adopted, and what they are:
#
#   linsnotes.com          CNAME → kuibinlin.github.io    a different site
#   www.linsnotes.com      CNAME → linsnotes.github.io    a different site
#   MX ×4                  Cloudflare Email Routing + SES
#   brevo1/2._domainkey    Brevo DKIM
#   resend._domainkey      Resend DKIM — the magic-link sender
#   send.linsnotes.com     SES SPF + MX
#   _dmarc, SPF, DKIM      email authentication
#   google / bing / github verification records
#   hsk-mcp.linsnotes.com  the dictionary Worker — a SEPARATE service
#
# Adopting email records would put every magic link and password-reset path
# under a `terraform destroy`. They are stable, unrelated to this app, and
# already work.
#
# hsk-mcp deserves its own note, because the argument for adopting it is
# tempting and wrong. MyDeck depends on it — integrations/hskMcp.js falls back
# to it, and from Cloud Run that hostname IS the dictionary, since no service
# binding is available there. But depending on a service is not owning it. By
# that reasoning this module would also manage SEA-LION's DNS.
#
# It is a standalone service with its own lifecycle. If it ever gets its own
# Terraform, its record belongs there — and having adopted it here would mean
# two states believing they own one record, which is the collision this
# repository avoids everywhere else (workers_script vs wrangler, Terraform vs
# CI over the Cloud Run image).
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THESE TWO ARE SAFE TO ADOPT
# ─────────────────────────────────────────────────────────────────────────────
#
# backend/wrangler.toml uses `[[routes]]` with a pattern, NOT a Worker Custom
# Domain:
#
#   [[routes]]
#   pattern   = "mydeckapi.linsnotes.com/*"
#   zone_name = "linsnotes.com"
#
# That distinction decides everything here. A Custom Domain has Cloudflare
# create and maintain the DNS record on the Worker's behalf, and importing one
# means two systems believing they own it — the same fight as workers_script.
# A route does not: it matches an incoming request, and YOU provide a proxied
# record for the hostname so the request reaches Cloudflare's edge at all.
#
# So these records were created by hand and no other system reconciles them.

locals {
  # Cloudflare's discard address. The AAAA records below point at it because
  # the destination genuinely does not matter — `proxied = true` means the
  # request terminates at Cloudflare's edge, where the Worker route matches
  # before anything is ever forwarded. 100:: is reserved for discard precisely
  # so it cannot accidentally reach a real host.
  #
  # An unproxied record pointing here would black-hole the hostname, which is
  # why `proxied` is not optional for the API record below.
  worker_route_target = "100::"

  # 1 means "Auto" — Cloudflare picks. Not settable alongside proxied=true
  # anyway, since a proxied record's TTL is Cloudflare's to choose.
  ttl_auto = 1
}


# ─────────────────────────────────────────────────────────────────────────────
# The API. Losing this record takes the whole backend down.
#
# It is also half of the reason authentication works at all. The session cookie
# is `HttpOnly; Secure; SameSite=Lax` (backend/src/http/session.js), and Lax is
# only viable because the frontend and the API share the linsnotes.com eTLD+1 —
# they are same-site, so the cookie is sent. That replaced SameSite=None, which
# iOS Safari blocked from a cross-site workers.dev domain.
#
# Which means this is not merely "where the API lives". Moving the API to a
# different registrable domain breaks login on iOS, and nothing in the code
# would say why. That constraint has lived in a comment and in a dashboard;
# this is the first time it is expressed as infrastructure.
# ─────────────────────────────────────────────────────────────────────────────
resource "cloudflare_dns_record" "api" {
  zone_id = data.cloudflare_zone.main.zone_id
  name    = "mydeckapi.linsnotes.com"
  type    = "AAAA"
  content = local.worker_route_target
  proxied = true
  ttl     = local.ttl_auto

  lifecycle {
    prevent_destroy = true
  }
}


# ─────────────────────────────────────────────────────────────────────────────
# The frontend. The other half of the eTLD+1 arrangement above.
#
# Points at the Pages project adopted in main.tf — mydeck.pages.dev is that
# project's subdomain. Deliberately NOT wired as a Terraform dependency on
# cloudflare_pages_project.frontend: the value is a fact about DNS, and making
# it a reference would couple a record that must survive to a resource whose
# plan is permanently noisy for provider reasons.
# ─────────────────────────────────────────────────────────────────────────────
resource "cloudflare_dns_record" "frontend" {
  zone_id = data.cloudflare_zone.main.zone_id
  name    = "mydeck.linsnotes.com"
  type    = "CNAME"
  content = "mydeck.pages.dev"
  proxied = true
  ttl     = local.ttl_auto

  lifecycle {
    prevent_destroy = true
  }
}
