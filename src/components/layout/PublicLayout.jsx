// PublicLayout — wraps all public pages (landing + auth).
// Provides PublicHeader and Footer without requiring authentication.
import PublicHeader from './PublicHeader'
import Footer from './Footer'
import { Outlet } from 'react-router'

export default function PublicLayout() {
  return (
    <>
      <PublicHeader />
      <Outlet />
      <Footer />
    </>
  )
}
