import { Navigate, Outlet } from 'react-router'
import { useAuth } from '@/context/AuthContext'
import Header from './Header'
import Footer from './Footer'
import Spinner from '@/components/ui/Spinner'

// `bare` gives the page everything below the header: no footer, no padded
// container, and a scroll region it owns. A bottom-docked composer and a page
// footer cannot coexist, so the tutor tab needs it. Height comes from flex
// rather than a calc against the header, which would silently break the day
// the header's padding changes.
export default function ProtectedRoute({ bare = false }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <Spinner center />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (bare) {
    return (
      <div className="h-dvh flex flex-col">
        <Header />
        <main className="flex-1 min-h-0">
          <Outlet />
        </main>
      </div>
    )
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
