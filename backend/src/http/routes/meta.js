// Operational endpoints: liveness and release identity.
//
// Neither is used by the Cloudflare runtime — Workers has no orchestrator
// probing a container before it routes traffic, so nothing here is required for
// the app to serve. They exist for the things *around* the deploy:
//
//   - a post-deploy smoke test in CI ("did that actually ship and boot?")
//   - uptime monitoring from outside Cloudflare
//   - rollback verification — /version answers "which build is live right now?",
//     which is the question you cannot answer from the dashboard once two
//     deploys look identical
//
// They stay useful unchanged if the API is ever moved onto a platform that does
// probe (Cloud Run, Kubernetes), which is the other reason to have them.

import { json } from "../respond.js";

// Deliberately does NOT touch D1, KV or AI.
//
// A health check is only worth having if it is safe to call constantly, and
// anything that queries the database turns an uptime monitor into write-free but
// unbounded read load, and hands an unauthenticated caller a way to make the
// worker do work. What this proves is real and enough: the script parsed, the
// module graph loaded, the route table matched, and CORS applied. Those are the
// failures a bad deploy actually produces.
//
// If you ever need "can the worker reach D1", add it as a SEPARATE authenticated
// endpoint rather than widening this one — the two have opposite requirements.
export function health(request) {
  return json({ status: "ok" }, 200, request);
}

// APP_VERSION is not in wrangler.toml's [vars] on purpose — a version committed
// to a config file is a version that goes stale the first time someone forgets
// to bump it. Set it at deploy time from the commit that produced the build:
//
//   wrangler deploy --var APP_VERSION:$(git rev-parse --short HEAD)
//
// Unset (local dev, or a hand-run deploy) reports "development", which is
// accurate rather than misleading.
export function version(request, env) {
  return json(
    {
      version: env.APP_VERSION ?? "development",
      environment: env.APP_VERSION ? "production" : "development",
    },
    200,
    request,
  );
}
