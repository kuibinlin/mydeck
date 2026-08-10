// === LinNotes API Worker ===
//
// Layering, top to bottom. Each layer only knows about the one below it.
//
//   index.js        entry point: preflight, dispatch, error mapping
//   http/           transport — Request/Response, CORS, cookies, routing
//   services/       domain logic — (env, args) in, data out, throws AppError
//   ai/             model access — providers, callModel, structured generation
//   integrations/   third-party APIs — Resend, GitHub, the agent service
//
// tools/ was the sixth layer and is gone with §11 step 9: the agent that called
// those wrappers now runs in services/agent-service, and it asks rather than
// acts (architecture.md §8.2). What it asks for is materialised by
// services/tutor.js through the same services an HTTP route would call.
//
// The rule that keeps this useful: services/ never imports from http/. That is
// what lets a test and an HTTP route call the same function without faking a
// Request — and it is what made moving the loop out of process a change to one
// file rather than to the layer.

import { json, preflight, errorResponse } from "./http/respond.js";
import { createRouter } from "./http/router.js";
import { routes } from "./http/routes/index.js";

const match = createRouter(routes);

export default {
  // `ctx` is passed to handlers and no further. Nothing currently reads it:
  // shadow mode was its only user and went with §11 step 9. It stays in the
  // signature because a handler needing work that outlives the response is a
  // normal thing to want, and the rule for when that happens is worth keeping
  // written down — pass `ctx.waitUntil` down as a bound function, never the
  // context object, so services/ keeps taking (env, args) and stays callable
  // from a test with no runtime object to fake.
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return preflight(request);

    try {
      const route = match(request.method, new URL(request.url).pathname);
      if (!route) return json({ error: "Not found" }, 404, request);
      return await route.handler(request, env, route.params, ctx);
    } catch (err) {
      return errorResponse(err, request);
    }
  },
};
