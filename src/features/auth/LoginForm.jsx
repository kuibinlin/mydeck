import { useState } from 'react'
import { Link } from 'react-router'
import { requestMagicLink } from './authApi'

// Handles email + optional username → magic link flow
// onSuccess: called after link is sent
export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [showUsername, setShowUsername] = useState(false)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!email.trim()) {
      setMsg({ type: 'error', text: 'Please enter your email' })
      return
    }
    setLoading(true)
    setMsg(null)
    try {
      const data = await requestMagicLink(
        email.trim(),
        showUsername ? username.trim() : undefined,
      )
      if (data.needsUsername) {
        setShowUsername(true)
        setMsg({ type: 'success', text: 'Welcome! Pick a username to get started.' })
        return
      }
      setMsg({ type: 'success', text: 'Check your email and click the login link!' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {msg && (
        <div className={msg.type === 'error'
          ? 'p-2.5 px-3.5 rounded-lg mb-4 text-sm bg-red-100 text-red-700 dark:bg-red-900/15 dark:text-[#ff6b6b]'
          : 'p-2.5 px-3.5 rounded-lg mb-4 text-sm bg-green-100 text-green-700 dark:bg-green-900/15 dark:text-[#6ee7a0]'
        }>
          {msg.text}
        </div>
      )}

      <div className="mb-4">
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
      </div>

      {showUsername && (
        <div className="mb-4">
          <input
            type="text"
            placeholder="Pick a username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
        </div>
      )}

      <button
        className="w-full inline-flex items-center justify-center gap-1.5 px-5 py-3 bg-primary hover:bg-primary-hover text-white text-sm font-semibold rounded-btn transition-all cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={handleSubmit}
        disabled={loading}
      >
        <i className="fas fa-paper-plane" />
        {loading ? 'Sending…' : 'Send login link'}
      </button>

      {/* divider */}
      <div className="flex items-center gap-3 my-5 text-muted text-xs">
        <div className="flex-1 h-px bg-border" />
        or
        <div className="flex-1 h-px bg-border" />
      </div>

      <a
        href={`${import.meta.env.VITE_API_URL}/auth/github`}
        className="w-full inline-flex items-center justify-center gap-1.5 px-5 py-3 bg-[#24292e] hover:bg-[#1a1e22] text-white text-sm font-semibold rounded-btn transition-all cursor-pointer border border-transparent dark:bg-[#2d333b] dark:border-[#444c56] dark:hover:bg-[#373e47]"
      >
        <i className="fab fa-github" />
        Continue with GitHub
      </a>

      {/* Passive consent notice — satisfies PDPA requirement */}
      <p className="text-xs text-muted text-center mt-5 leading-relaxed">
        By continuing, you agree to our{' '}
        <Link to="/terms" className="text-primary no-underline">Terms of Service</Link>
        {' '}and{' '}
        <Link to="/privacy" className="text-primary no-underline">Privacy Policy</Link>.
      </p>
    </>
  )
}
