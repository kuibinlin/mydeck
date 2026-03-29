import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '@/context/AuthContext'
import LoginForm from './LoginForm'

export default function AuthPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  if (user) return null

  return (
    <div className="min-h-[calc(100vh-130px)] flex items-center justify-center p-10">
      <div className="w-full max-w-md bg-surface rounded-card shadow-card px-8 py-9">
        <div className="mb-6 text-center">
          <h2 className="text-[1.6rem] font-bold mb-1.5">
            Welcome to MyDeck
          </h2>
          <p className="text-muted text-sm">
            Sign in or create your account — no password needed.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
