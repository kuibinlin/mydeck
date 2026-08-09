# cloudflare/

Adopts Cloudflare resources that already exist and hold live data.

This is the **import/adopt** lifecycle — the third of the three in
`docs/architecture.md` §9.1, and the one that behaves differently from every
other module here. The GCP roots created resources that had never existed, so a
plan full of additions was correct. Here, a plan full of anything is a bug.

> **After importing, `terraform plan` must report
> `0 to add, 0 to change, 0 to destroy`.**
>
> If it proposes a change, the *configuration* is wrong. Fix the `.tf` file.
> Never apply a diff you did not intend — the thing on the other side is a
> database of real users and a namespace holding every active session.

## Before you start

```bash
export CLOUDFLARE_API_TOKEN='...'      # shell only, never a file
cp terraform.tfvars.example terraform.tfvars   # then fill in three values
terraform init
```

The token needs `Zone:DNS:Edit` and `Zone:Zone Settings:Edit` on the zone, plus
`Account:D1:Edit`, `Account:Workers KV Storage:Edit` and
`Account:Cloudflare Pages:Edit`. It is **not** the deploy token in GitHub Actions
secrets — that one is scoped to Workers Scripts:Edit and ships the Worker. This
one can rewrite DNS and stays on your machine.

## Import

The IDs are already in `backend/wrangler.toml` — the Worker binds by them:

```bash
grep -E 'database_id|^id' ../../../backend/wrangler.toml
```

Then, with `ACCOUNT` set to your account ID:

```bash
terraform import cloudflare_d1_database.main         "$ACCOUNT/<database_id>"
terraform import cloudflare_workers_kv_namespace.sessions "$ACCOUNT/<namespace_id>"
terraform import cloudflare_pages_project.frontend   "$ACCOUNT/<pages_project_name>"
```

Then the check that decides whether this worked:

```bash
terraform plan
```

**Zero changes is the pass.** Anything else means the configuration does not
describe what is really there. The likeliest culprit is the Pages project, whose
build configuration this file deliberately does not guess — see below.

Finally, confirm the Worker still points at what Terraform now manages:

```bash
terraform output -raw binding_check
```

Terraform owns the database and the namespace; `backend/wrangler.toml` holds
their IDs by hand. If those disagree, the Worker is bound to something Terraform
does not manage.

## Deliberately not managed

**The Worker script.** `cloudflare_workers_script` couples `content`,
`bindings`, `compatibility_date` and `observability` into one resource — the
same set `wrangler.toml` declares and `wrangler deploy` uploads. There is no
seam: whichever tool uploads the script owns its bindings. §9.

**Cloudflare secrets.** `cloudflare_workers_secret` was removed in provider v5,
so §10 enforces itself. `wrangler secret put`.

**Pages deployments.** Pages builds on push through its GitHub integration.
Terraform owns the project's configuration, not its releases — the same split as
the Worker script and as Cloud Run's image.

**Pages `build_config`, for now.** Left empty with `ignore_changes = []` rather
than guessed. Writing it from memory is how you get a plan that proposes to
change a working build. Fill it in *after* the first import shows what is
actually configured, and then the settings recorded in
`infrastructure/README.md` become a diff instead of a rediscovery.

## DNS — a second pass

Not written yet, and not from laziness.

`mydeckapi.linsnotes.com` is a Worker custom domain and `mydeck.linsnotes.com`
is likely a Pages one. Cloudflare **creates and manages those DNS records
itself** when a custom domain is attached, so importing one into Terraform can
produce a fight neither side wins — the same class of problem as
`workers_script`.

List the zone first and see what is actually there:

```bash
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$(terraform output -raw zone_id)/dns_records" \
  | python3 -c "import json,sys; [print(f\"{r['type']:6} {r['name']:34} proxied={r['proxied']}  {r['content'][:40]}\") for r in json.load(sys.stdin)['result']]"
```

Records Cloudflare manages on behalf of a custom domain should be left alone.
Ordinary records — anything else serving this zone — are safe to adopt, and are
the ones worth having in Git: the `SameSite=Lax` cookie arrangement the whole
auth design rests on is a fact about *which hostnames share `linsnotes.com`*,
and it currently exists nowhere but a dashboard.

Start narrow. Widening later is easy; un-widening after an accidental destroy is
not.
