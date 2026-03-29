// src/context/AuthContext.jsx
// Global auth state — user object and login/logout actions.
//
// Session is managed via httpOnly cookie (set by the Worker).
// The frontend never sees or stores the session token — the browser
// handles it transparently on every API request.
//
// Boot sequence:
//   1. Magic link click  → URL contains #verify=<token>
//      → POST /auth/verify  → Worker validates, sets cookie, returns { user }
//   2. GitHub OAuth      → Worker sets cookie on redirect, lands on /login
//      → falls through to /auth/me below
//   3. Returning visit   → no hash, cookie already in browser
//      → GET /auth/me   → Worker reads cookie, returns { user }

import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '@/lib/apiClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const hash = window.location.hash

    // Magic link: /login#verify=<one-time-token>
    // Worker verifies the token, creates a KV session, and sets the cookie
    // in the response. We just read back the user object.
    if (hash.startsWith('#verify=')) {
      const verifyToken = hash.replace('#verify=', '')
      history.replaceState(null, '', window.location.pathname)
      api(`/auth/verify?token=${encodeURIComponent(verifyToken)}`)
        .then(data => setUser(data.user))
        .catch(() => setUser(null))
        .finally(() => setLoading(false))
      return
    }

    // Returning visit or post-GitHub-OAuth redirect:
    // Cookie is sent automatically — Worker returns the stored user.
    api('/auth/me')
      .then(data => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  // Called after any login path that returns a user object directly
  // (e.g. a future password-based login endpoint).
  // Cookie is already set by the Worker response — just update local state.
  const login = (userData) => {
    setUser(userData)
  }

  const logout = async () => {
    try {
      // Worker deletes the KV session and clears the cookie.
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // Safe to ignore — cookie is cleared by the Worker on best-effort basis.
      // If the request fails, the session will expire naturally in KV.
    }
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === null) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
