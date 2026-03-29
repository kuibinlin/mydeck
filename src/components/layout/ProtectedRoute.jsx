import { Navigate, Outlet } from 'react-router'
import { useAuth } from '@/context/AuthContext'
import Header from './Header'
import Footer from './Footer'
import Spinner from '@/components/ui/Spinner'

export default function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return <Spinner center />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col">
        <div className="w-full max-w-6xl mx-auto px-10 py-8 flex-1 flex flex-col max-md:px-6">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  )
}
