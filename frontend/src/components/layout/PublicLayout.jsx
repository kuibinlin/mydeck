// PublicLayout — wraps all public pages (landing + auth).
// Provides PublicHeader and Footer without requiring authentication.
import PublicHeader from './PublicHeader'
import Footer from './Footer'
import { Outlet } from 'react-router'

export default function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicHeader />
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
