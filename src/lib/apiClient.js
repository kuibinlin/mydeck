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

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}
