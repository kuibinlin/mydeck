# Secrets

Where every secret lives, how to set it, and how to rotate it.

The rule underneath all of it: **Terraform creates containers, never values.**
Terraform state records resource attributes in plaintext, so a secret passed
through a variable becomes a secret sitting in the state bucket — and in every
historical generation the bucket's versioning keeps. See
[architecture.md §10](architecture.md#10-secrets).

---

## The map

| Store | Holds | Set with |
|---|---|---|
| Cloudflare Worker | `RESEND_API_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `AI_API_KEY`, `AGENT_SERVICE_SECRET` | `wrangler secret put` |
| Google Secret Manager | the agent service's four, below | `gcloud secrets versions add` |
| GitHub Actions | the Cloudflare **deploy** token only | GitHub UI or `gh` |
| Your machine | the Cloudflare **Terraform** token, the GitHub PAT | env vars / `gcloud auth` |
| Google credentials | **nothing stored** — Workload Identity Federation | — |

Never in: git, `.tfvars`, Docker images, `.env.example`, `wrangler.toml.example`,
Terraform variables, Actions **variables** (as opposed to secrets).

`AGENT_SERVICE_SECRET` is the only value that appears in two stores, and it must
be the same value in both. That is its own section below.

---

## Google Secret Manager — the agent service

`infrastructure/terraform/secrets-dev/` creates these as **empty containers**.
An empty secret cannot be mounted, so Cloud Run fails to deploy until each has a
version. Terraform cannot detect this: it created what it was asked to create.

| Secret | Env var | Required |
|---|---|---|
| `mydeck-agent-dev-service-secret` | `AGENT_SERVICE_SECRET` | yes |
| `mydeck-agent-dev-ai-api-key` | `AI_API_KEY` | yes |
| `mydeck-agent-dev-langfuse-public-key` | `LANGFUSE_PUBLIC_KEY` | only with `enable_tracing` |
| `mydeck-agent-dev-langfuse-secret-key` | `LANGFUSE_SECRET_KEY` | only with `enable_tracing` |

Production uses `mydeck-agent-prod-*`, from a separate root module with separate
state. Never share a value across environments: two environments reading one
secret means rotating dev rotates prod, and a value leaked from the environment
you experiment in is the value production is using.

Everything else the container reads — `AI_PROVIDER`, `AI_TUTOR_MODEL`,
`AI_BASE_URL`, `AI_TEMPERATURE`, `AGENT_DEADLINE_S`, `HSK_MCP_URL`,
`HSK_TIMEOUT_S` — is plain configuration and belongs in the Cloud Run service
definition. Secret Manager is for values that would matter if they leaked.

### The order

```text
1. terraform apply    in secrets-dev/     creates empty containers
2. gcloud secrets versions add            by hand, per secret        ← you are here
3. verify every secret has an enabled version
4. terraform apply    in run-dev/         mounts them
```

Skipping step 2 fails step 4, one module after the omission.

### Setting values

The module generates the exact commands from the names it actually created.
**`-raw` matters** — without it Terraform prints the string JSON-quoted with
literal `\n`, one unusable line:

```bash
cd infrastructure/terraform/secrets-dev
terraform output -raw set_values
```

Each command looks like this, and they are meant to be run one at a time:

```bash
printf 'AI_API_KEY: '; IFS= read -rs AI_API_KEY; echo

printf '%s' "$AI_API_KEY" | gcloud secrets versions add mydeck-agent-dev-ai-api-key \
  --data-file=- --project=mydeck-linsnotes

unset AI_API_KEY
```

Four details, each load-bearing:

- **`printf '<NAME>: '`** — names what the prompt is waiting for. Run these as a
  block with unlabelled prompts and entering them out of order writes the AI key
  into the service secret. Both commands succeed; the mismatch surfaces at the
  first model call.
- **`IFS= read -rs`** — `-s` does not echo, so the value stays off screen and out
  of history; `-r` takes it raw, so a backslash is not an escape; `IFS=` keeps
  leading and trailing whitespace instead of stripping it.
- **`printf '%s'`** — no trailing newline. A newline becomes part of the stored
  secret, and the resulting auth failure looks nothing like its cause.
- **`--data-file=-`** — the value arrives on stdin, so it is never in `argv`
  where `ps` and history can see it.

> **Why the prompt is a separate `printf`.** `read`'s own prompt flag is not
> portable — bash spells it `read -rsp 'NAME: ' NAME`, while in zsh `-p` means
> *read from a coprocess* and the prompt goes inside the variable spec:
> `read -rs "NAME?NAME: "`. Either form fails in the other shell, and this
> repository's default shell is zsh while most published runbooks are bash.
> `printf` plus a bare `read` behaves identically in both.

### Verifying without revealing

Never `gcloud secrets versions access` just to check something is set — that
prints the value. Count versions instead:

```bash
terraform output -raw unset_check
```

which runs to:

```text
mydeck-agent-dev-service-secret: 1
mydeck-agent-dev-ai-api-key: 1
```

`0` means the container is empty and `run-dev/` will fail. Run this before
touching `run-dev/`.

---

## `AGENT_SERVICE_SECRET` — generate once, set twice

This value proves a request came from the Worker. It travels as the
`X-MyDeck-Agent-Secret` header (`integrations/agentService.js`), and
`app/main.py` refuses to serve on Cloud Run without it — a missing secret fails
loudly rather than leaving public ingress unauthenticated.

It exists in **two** stores and both must hold the same value:

```text
Cloudflare Worker secret  ──sends──▶  X-MyDeck-Agent-Secret
                                              │
Google Secret Manager     ──expects──▶────────┘
```

Generate it once and set it in both places. Generating separately per side is
the mistake this ordering exists to prevent:

```bash
SECRET=$(openssl rand -hex 32)

printf '%s' "$SECRET" | gcloud secrets versions add mydeck-agent-dev-service-secret \
  --data-file=- --project=mydeck-linsnotes

cd backend && npx wrangler secret put AGENT_SERVICE_SECRET   # paste the same value

unset SECRET
```

**Hex, not base64.** The value crosses a shell variable, an HTTP header and two
different config systems; `+`, `/` and `=` in any of those is one escaping bug
waiting to happen.

---

## Rotation

### Worker-only secrets

`RESEND_API_KEY`, the GitHub OAuth pair, `AI_API_KEY` — rotate at the provider,
then `wrangler secret put`. The Worker picks the new value up on the next
request; there is no window.

### `AGENT_SERVICE_SECRET`

There is **no zero-downtime order**, because the agent compares against exactly
one expected value. Whichever side you update first, the two disagree until the
other catches up.

What saves you is that the disagreement is graceful. A rejected request returns a
status error, `integrations/agentService.js` tags it `.reason = "status"`, and
everything except a timeout **falls through to the JavaScript tutor loop**. So
the rotation window costs the Python path, not the answer — learners get the JS
tutor and notice nothing.

```bash
# 1. New value
SECRET=$(openssl rand -hex 32)

# 2. Google side — new version
printf '%s' "$SECRET" | gcloud secrets versions add mydeck-agent-dev-service-secret \
  --data-file=- --project=mydeck-linsnotes

# 3. Restart Cloud Run so the container reads the new version.
#    Env-var secret mounts resolve at instance start, not live — without this,
#    running instances keep serving with the old value.
gcloud run services update mydeck-agent-dev --region=asia-southeast1 \
  --project=mydeck-linsnotes

# 4. Cloudflare side — window closes here
cd backend && npx wrangler secret put AGENT_SERVICE_SECRET

unset SECRET
```

Then retire the old version, so a leaked copy stops being useful:

```bash
gcloud secrets versions list mydeck-agent-dev-service-secret --project=mydeck-linsnotes
gcloud secrets versions disable <OLD> --secret=mydeck-agent-dev-service-secret \
  --project=mydeck-linsnotes
```

Disable before destroy. A disabled version can be re-enabled if the rotation
turns out to have been wrong; a destroyed one cannot.

**While `AGENT_ENABLED` is false — which is the shipping state — rotation has no
user-visible effect at all.** Nothing calls the agent. Rotate freely now; the
sequence above matters from §11 step 7 onward.

---

## Local development

No Google credentials, no Secret Manager, no runtime service account. The Worker
reads `backend/.dev.vars` (gitignored) and the Python service reads its own
environment:

```bash
AGENT_SERVICE_URL=http://localhost:8080
AGENT_SERVICE_SECRET=any-value-both-sides-share
```

`app/main.py` only *requires* the secret when `K_SERVICE` is set, which Cloud Run
sets and your laptop does not — so a local run without it works, and a deployed
one refuses. That asymmetry is deliberate.

Tests never reach a real secret or a real network: `backend/test/safety.test.js`
and `services/agent-service/tests/test_safety.py` assert it.

---

## If a secret leaks

1. **Rotate first, investigate second.** Every secret here is replaceable in
   minutes; none is worth a delay for diagnosis.
2. `AGENT_SERVICE_SECRET` — follow the rotation order above. Until it completes,
   anyone holding the old value can reach the agent service directly.
3. `AI_API_KEY` — revoke at the provider, not just here. A rotated copy in Secret
   Manager does nothing about the old key still working.
4. GitHub OAuth pair — reset in the GitHub app settings; existing sessions are
   unaffected, since they live in KV rather than being derived from these.
5. Check for user-managed service account keys, which should never exist:

```bash
gcloud iam service-accounts keys list --managed-by=user \
  --iam-account=mydeck-deploy@mydeck-linsnotes.iam.gserviceaccount.com
```

`Listed 0 items` is the expected answer. Anything else was created out of band
and defeats the point of Workload Identity Federation.
