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
- **Deploy credentials are a separate question.** `wrangler deploy` needs a
  `CLOUDFLARE_API_TOKEN` secret scoped to Workers Scripts:Edit. Nothing here
  needs it until you add a deploy job — and deploying from CI should probably
  wait until `infrastructure/` decides what owns which resource.

## Suggested split

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | pull request, push to `main` | lint, both test suites, build |
| `deploy-api.yml` | push to `main` (paths: `backend/**`) | `npm run deploy:api` |
| `deploy-web.yml` | push to `main` (paths: `frontend/**`) | build + `wrangler pages deploy frontend/dist` |

Path filters matter here — the two halves deploy to different places on
different cadences, and a frontend copy change should not redeploy the API.
