// src/features/auth/authApi.js
// all auth API calls to your Cloudflare Worker
// login, logout, verify, check session

import { api } from '@/lib/apiClient'

// send magic link email
export const requestMagicLink = (email, username) =>
  api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      username: username || undefined,
      redirectBase: window.location.origin,
    })
  })

// verify magic link token from URL
export const verifyMagicLink = (token) =>
  api(`/auth/verify?token=${token}`)

// check current session
export const getMe = () =>
  api('/auth/me')

// logout
export const logout = () =>
  api('/auth/logout', { method: 'POST' })