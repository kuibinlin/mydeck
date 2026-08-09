// Response construction and CORS.
//
// The only module that knows about Response headers. Services return data;
// this turns data into HTTP.

import { PROD_ORIGINS } from "../config.js";

// Access-Control-Allow-Credentials is required for cross-origin cookie-based auth.
// The origin must be explicit (not '*') when credentials are included.
// localhost origins are only allowed when running via wrangler dev (worker URL is localhost).
// Any localhost port is accepted in dev, not just 5173 — Vite falls back to 5174, 5175, ...
// when the preferred port is taken, and a hardcoded port turns that into an opaque CORS error.
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function corsHeaders(request) {
  const workerHost = new URL(request.url).hostname;
  const isDev = workerHost === "localhost" || workerHost === "127.0.0.1";
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
  // Unknown origins get no ACAO header at all, which is what makes the browser
  // block the response. In production isDev is false, so only PROD_ORIGINS
  // are ever reflected.
  if (PROD_ORIGINS.includes(origin) || (isDev && DEV_ORIGIN.test(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Pass a cookie string as the 4th argument to set Set-Cookie on the response.
export function json(data, status = 200, request = null, cookie = null) {
  const headers = {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    ...(request ? corsHeaders(request) : {}),
  };
  if (cookie !== null) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(data), { status, headers });
}

export function preflight(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

// Maps a thrown value to a response. AppError (and anything else carrying a
// numeric status) becomes that status; everything else is an unexpected
// failure and is logged.
export function errorResponse(err, request) {
  if (err?.status) return json({ error: err.message }, err.status, request);
  console.error(err);
  return json({ error: "Internal server error" }, 500, request);
}
