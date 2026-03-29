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
    <>
      <Header />
      <Outlet />
      <Footer />
    </>
  )
}
