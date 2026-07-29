import { json } from "../respond.js";
import {
  sessionCookie,
  getTokenFromCookie,
  requireUser,
} from "../session.js";
import { isAdmin } from "../../services/access.js";
import * as auth from "../../services/auth.js";
import { PROD_ORIGINS } from "../../config.js";

export async function login(request, env) {
  const { email, username, redirectBase } = await request.json();

  // Only an allow-listed origin may be used as the link target, so a crafted
  // request cannot point the login email at an attacker's domain.
  const frontendBase =
    redirectBase && PROD_ORIGINS.includes(redirectBase)
      ? redirectBase + "/"
      : env.FRONTEND_URL;

  const result = await auth.startEmailLogin(env, {
    email,
    username,
    frontendBase,
  });
  return json(result, 200, request);
}

// The one shape the frontend ever sees for a user.
//
// /auth/verify and /auth/me must agree: verify is what a *fresh* login returns,
// me is what every later page load returns. When they differed, a field missing
// from verify was invisible until the user happened to reload — the settings
// page showed a blank email to exactly the people who had just signed in.
function publicUser(user, env) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    isAdmin: isAdmin(user, env),
  };
}

export async function verify(request, env) {
  const token = new URL(request.url).searchParams.get("token");
  const { user, sessionToken } = await auth.verifyMagicToken(env, { token });

  return json(
    { ok: true, user: publicUser(user, env) },
    200,
    request,
    sessionCookie(sessionToken),
  );
}

export async function githubStart(request, env) {
  const state = await auth.createOAuthState(env);
  const redirectUri = `${new URL(request.url).origin}/auth/github/callback`;
  return Response.redirect(
    auth.githubAuthorizeUrl(env, { redirectUri, state }),
    302,
  );
}

export async function githubCallback(request, env) {
  const url = new URL(request.url);
  const frontend = env.FRONTEND_URL.replace(/\/$/, "");

  // Failures redirect back to the app rather than rendering JSON, because the
  // browser is mid-navigation here, not mid-fetch.
  try {
    const { handoffCode } = await auth.completeGitHubLogin(env, {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
    });
    return Response.redirect(`${frontend}/login#verify=${handoffCode}`, 302);
  } catch (err) {
    console.error("GitHub callback failed:", err.message || err);
    return Response.redirect(`${env.FRONTEND_URL}#error=auth_failed`, 302);
  }
}

export async function me(request, env) {
  const user = await requireUser(request, env);
  return json({ user: publicUser(user, env) }, 200, request);
}

export async function logout(request, env) {
  await auth.destroySession(env, getTokenFromCookie(request));
  // Clear the cookie whether or not a session existed.
  return json({ ok: true }, 200, request, sessionCookie(null));
}
