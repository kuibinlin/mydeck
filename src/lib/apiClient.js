// src/lib/apiClient.js
// Base fetch wrapper for all API calls.
//
// Authentication is handled via httpOnly session cookie — the browser attaches
// it automatically on every request. No token is read or stored here.
// `credentials: 'include'` is required for cross-origin cookie sending
// (frontend on linsnotes.com → API on linsnotes-api.kuibin.workers.dev).

const API = import.meta.env.VITE_API_URL

export async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  // Not every response that reaches here is JSON. A 502 from a gateway, a
  // Cloudflare error page, or an empty 204 all arrive as something `res.json()`
  // would throw on — and that throw surfaces to the user as
  // `Unexpected token '<'`, which describes our parser rather than their
  // problem. Parse defensively and let the status say what happened.
  const body = await res.text()
  let data = null
  if (body) {
    try {
      data = JSON.parse(body)
    } catch {
      if (res.ok) throw new Error('The server sent something unreadable.')
    }
  }

  if (!res.ok) throw new Error(data?.error || statusMessage(res.status))
  return data ?? {}
}

function statusMessage(status) {
  if (status === 401) return 'Please sign in again.'
  if (status === 403) return "You don't have access to that."
  if (status === 404) return 'Not found.'
  if (status === 429) return "That's a bit too fast — try again in a moment."
  if (status >= 500) return 'The server is having trouble. Try again shortly.'
  return 'Request failed'
}
