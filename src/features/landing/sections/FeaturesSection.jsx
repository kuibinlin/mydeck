import { FEATURES } from '../landingContent'

export default function FeaturesSection() {
  return (
    <section className="relative max-w-6xl mx-auto px-10 py-[72px] max-md:px-6 max-md:py-12 overflow-hidden" id="features">
      {/* Background glow — top-right, mirrors hero */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_srgb,var(--color-primary)_7%,transparent)_0%,transparent_65%)]" />

      <div className="relative text-center mb-12">
        <h2 className="text-3xl max-md:text-2xl font-extrabold tracking-tight mb-2 bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">
          Everything you need to learn your way
        </h2>
        <p className="text-muted text-base">Three tools. One platform. All yours.</p>
      </div>
      <div className="relative grid grid-cols-3 gap-6 max-md:grid-cols-1">
        {FEATURES.map(f => (
          <div key={f.title} className="bg-surface rounded-card border border-border px-6 py-7 transition-all hover:shadow-hover hover:-translate-y-0.5 text-center">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-xl mb-4 mx-auto"
              style={{ background: f.color + '18' }}
            >
              <i className={f.icon} style={{ color: f.color }} />
            </div>
            <h3 className="text-base font-bold mb-2 text-text">{f.title}</h3>
            <p className="text-sm text-muted leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
