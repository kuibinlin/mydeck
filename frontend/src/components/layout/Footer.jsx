// Footer — shared across public pages and the authenticated app.
// To add/remove links, edit the FOOTER_LINKS array below.
import { Fragment } from 'react'
import { Link } from 'react-router'

const FOOTER_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Terms of Service', to: '/terms' },
]

export default function Footer() {
  return (
    <footer className="text-center py-6 px-5 border-t border-border text-muted text-sm">
      <div className="flex items-center justify-center gap-3 flex-wrap mb-2">
        {FOOTER_LINKS.map((link, i) => (
          <Fragment key={link.to}>
            {i > 0 && <span className="text-border select-none">&middot;</span>}
            <Link to={link.to} className="text-muted no-underline transition-all hover:text-primary">{link.label}</Link>
          </Fragment>
        ))}
      </div>
      <p className="m-0">
        &copy; {new Date().getFullYear()} Kuibin Lin &middot;{' '}
        <a href="https://linsnotes.com" className="text-muted no-underline transition-all hover:text-primary">linsnotes.com</a>
        {' '}&middot; Some rights reserved.
      </p>
    </footer>
  )
}
