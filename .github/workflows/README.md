# .github/workflows/

CI/CD workflows. **Empty on purpose** — no workflow is defined yet.

## The commands a workflow would run

All of these work today from a clean clone, and all run from the repo root. A
single `npm ci` installs both workspaces:

```bash
npm ci
npm run lint        # eslint across frontend/ and backend/
npm run test:web    # 76 tests, plain Node
npm run test:api    # 355 tests, inside workerd with local D1 + KV
npm run build       # → frontend/dist/
```

`npm run check` runs lint + both suites + build as one gate — right for a local
pre-push check. In CI, prefer the separate steps above: they fail for unrelated
reasons, and a combined script reports only the first failure. `test:api` is the
slow one (it boots workerd).

## Post-deploy smoke test

`GET /health` and `GET /version` exist for exactly this. A deploy job should
verify the deploy actually took, rather than trusting that `wrangler deploy`
exiting 0 means the new code is serving:

```bash
npx wrangler deploy --var APP_VERSION:${GITHUB_SHA::7}

test "$(curl -fsS https://mydeckapi.example.com/health | jq -r .status)" = "ok"
test "$(curl -fsS https://mydeckapi.example.com/version | jq -r .version)" = "${GITHUB_SHA::7}"
```

The second assertion is the one that matters — it fails if the deploy silently
rolled back or routed to an older version, which a `/health` check alone cannot
detect.

## Things that will bite

- **Node version.** Pin from `.nvmrc` (v24) — `actions/setup-node` reads it with
  `node-version-file: .nvmrc`. Do not hardcode a version in two places.
- **`npm ci`, not `npm install`.** There is one lockfile at the repo root
  covering both workspaces; `npm ci` is what respects it.
- **Install scripts are blocked by default.** `allowScripts` in the root
  `package.json` approves `workerd` and `esbuild` by exact version. When either
  is bumped, CI fails with a blocked-postinstall warning and `test:api` cannot
  boot — the fix is to add the new version key, not to disable the check.
- **Tests must not reach the network.** `backend/test/wrangler.test.toml` and the
  `outboundService` interceptor in `backend/vitest.config.mjs` guarantee that,
  and `backend/test/safety.test.js` asserts both guards are in place. This means
  CI needs **no** Cloudflare credentials to run the test suite.
- **Deploy credentials are a separate question, and now a settled one.**
  `wrangler deploy` needs a `CLOUDFLARE_API_TOKEN` secret scoped to Workers
  Scripts:Edit — and *only* that scope. A second, broader Cloudflare token
  exists for Terraform and must stay off this machine; see
  [docs/secrets.md](../../docs/secrets.md). Google needs **no stored
  credential**: `iam/` is applied, so `google-github-actions/auth` federates
  through Workload Identity, and only `refs/heads/main` may impersonate the
  deploy account.
- **Building the agent image on a Mac produces the wrong architecture.** Not a
  CI problem — `ubuntu-latest` is x86_64 — but the reason a locally built image
  and a CI-built one can behave differently. `services/agent-service/Dockerfile`
  has the detail.

## Container scanning

The agent image is scanned in **two separate steps, and only one of them can
fail the build.** That split is the whole design, so it is worth stating why
before the commands.

Scanned today, `mydeck-agent:local` reports:

```text
debian 12.15    24 findings    6 CRITICAL, 18 HIGH    0 FIXABLE
Python          0 findings
```

Every dependency you chose is clean. All 24 are Debian packages inside
`python:3.12-slim-bookworm`, and **none has a patched version available** —
Trivy reports 18 `affected`, 5 `fix_deferred`, 1 `will_not_fix`. Rebuilding
produces the identical result, because there is nothing to pull.

So gating on the raw count means a permanently red build, and a check that is
always red is a check nobody reads. Gate on what is actionable instead:

```yaml
- name: Report — never fails the build
  run: trivy image --format sarif --output trivy.sarif --severity CRITICAL,HIGH $IMAGE
- uses: github/codeql-action/upload-sarif
  with: { sarif_file: trivy.sarif }

- name: Gate — fails the build
  run: trivy image --ignore-unfixed --severity CRITICAL,HIGH --exit-code 1 $IMAGE
```

All 24 land in the Security tab, reviewable and trending; only fixable ones stop
a deploy. `--ignore-unfixed` is a statement about **actionability, not risk** —
which is exactly why the report step exists and is not conditional on it. Code
scanning upload is free on public repositories.

**Scan on a schedule, not only on build.** A finding can become fixable without
the image changing at all — Debian ships a patched `perl-base` and one of those
24 becomes actionable overnight. A build-triggered scan never re-runs on a
stable service, so that day passes unnoticed:

```yaml
on:
  schedule: [{ cron: "0 3 * * 1" }]   # weekly, against the deployed tag
```

`0 FIXABLE` is a snapshot of one vulnerability database on one day, not a
property of the image.

### Why the current findings are not urgent

**Assessed 2026-08-08, against `python:3.12-slim-bookworm` as built today.**
Recorded with its reasoning rather than its conclusion, because the reasoning is
what can be re-checked when the image changes:

| Package | Why unreachable |
|---|---|
| `perl-base` (incl. 4 CRITICAL) | the container runs only `uvicorn app.main:app`; nothing invokes perl |
| `ncurses-bin` | terminal handling; no TTY on Cloud Run |
| `util-linux` | `libblkid` disk-partition parsing |
| `zlib1g` CVE-2023-45853 | the overflow is in **minizip**, a contrib component Debian does not build into `libz1` — which is why it is the one `will_not_fix` |

This stops being true if the image gains a package, if the app shells out, or if
anything starts handling archives. Re-run the assessment then; do not inherit it.

Distroless would remove perl, ncurses and util-linux outright, and is worth
doing for attack surface on its own merits — but not to quiet this scan, and not
for free: it has no shell, and `CMD` currently uses one to read `$PORT`.

## Suggested split

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | pull request, push to `main` | lint, both test suites, build, `terraform fmt`/`validate` |
| `deploy-api.yml` | push to `main` (paths: `backend/**`) | test, `wrangler deploy`, smoke test `/version` |
| `deploy-agent.yml` | push to `main` (paths: `services/agent-service/**`) | build, scan, push, `gcloud run deploy` → **dev**; prod by dispatch |
| `scan.yml` | weekly schedule | re-scan the image production is currently serving |

Path filters matter here — the halves deploy to different places on different
cadences, and a frontend copy change should not redeploy the API.

**There is no `deploy-web.yml`, deliberately.** An earlier version of this table
listed one running `wrangler pages deploy`. That would now be a second system
deploying the frontend: Cloudflare Pages already builds `main` through its
GitHub integration, with build command, output directory and watch paths owned
by `infrastructure/terraform/cloudflare`. Two deployers for one artifact is the
same collision as Terraform and Wrangler over the Worker script — whichever runs
last wins, and neither knows about the other.

Two rules from [architecture.md §9.4](../../docs/architecture.md): pull requests
run checks only and never deploy, and Terraform applies only from a reviewed
merge — except `github/`, which applies locally, because its credential is a
repo-admin PAT and holding that in Actions secrets would put the credential that
governs the repository inside the repository it governs.
