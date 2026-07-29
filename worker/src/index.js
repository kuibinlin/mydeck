// === LinNotes API Worker ===
//
// Layering, top to bottom. Each layer only knows about the one below it.
//
//   index.js        entry point: preflight, dispatch, error mapping
//   http/           transport — Request/Response, CORS, cookies, routing
//   services/       domain logic — (env, args) in, data out, throws AppError
//   ai/             model access — providers, callModel, structured generation
//   integrations/   third-party APIs — Resend, GitHub
//   tools/          agent-callable wrappers around services
//
// The rule that keeps this useful: services/ never imports from http/. That is
// what lets an agent tool, a test, and an HTTP route all call the same
// function without faking a Request.

import { json, preflight, errorResponse } from "./http/respond.js";
import { createRouter } from "./http/router.js";
import { routes } from "./http/routes/index.js";

const match = createRouter(routes);

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return preflight(request);

    try {
      const route = match(request.method, new URL(request.url).pathname);
      if (!route) return json({ error: "Not found" }, 404, request);
      return await route.handler(request, env, route.params);
    } catch (err) {
      return errorResponse(err, request);
    }
  },
};
