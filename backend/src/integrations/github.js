// GitHub OAuth API calls.

const USER_AGENT = "LinNotes";

export function authorizeUrl({ clientId, redirectUri, state }) {
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user user:email&state=${state}`;
}

export async function exchangeCode(env, { code }) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

export async function fetchUser(accessToken) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
    },
  });
  return await res.json();
}

// GitHub omits the email from /user when the profile keeps it private.
export async function fetchPrimaryEmail(accessToken) {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
    },
  });
  const emails = await res.json();
  const primary = emails.find((e) => e.primary) || emails[0];
  return primary?.email;
}
