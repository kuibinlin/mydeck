// PublicHeader — used on landing page and auth page.
// Separate from the app Header (which requires authentication).
// Contains: logo, anchor nav links, theme toggle, sign-in button.
import { useNavigate } from 'react-router'
import { useTheme } from '@/context/ThemeContext'
import { NAV } from '@/features/landing/landingContent'

export default function PublicHeader() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <header
      className="sticky top-0 z-[100] border-b border-border"
      style={{ background: 'var(--color-bg)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <div className="max-w-6xl mx-auto px-10 py-4 flex items-center gap-3 max-md:px-6">
        {/* Logo */}
        <span
          className="text-xl font-bold cursor-pointer bg-transparent border-0 text-text p-0"
          onClick={() => navigate('/')}
        >
          <i className="fas fa-layer-group" style={{ color: 'var(--color-primary)', marginRight: 6 }} />
          {NAV.logo}
        </span>

        {/* Nav links — anchor links scroll to sections on the landing page */}
        <nav className="flex items-center gap-1 ml-6 max-md:hidden">
          {NAV.links.map(link => (
            <a key={link.href} href={link.href} className="px-3 py-1.5 rounded-lg text-muted text-sm font-semibold no-underline transition-all hover:text-text hover:bg-black/5 dark:hover:bg-white/5">
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={toggleTheme} title="Toggle theme" className="inline-flex items-center justify-center px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-colors cursor-pointer border-0">
            <i className="fas fa-circle-half-stroke" />
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
            onClick={() => navigate(NAV.signIn.to)}
          >
            {NAV.signIn.label}
          </button>
        </div>
      </div>
    </header>
  )
}
