import { FEATURES } from '../landingContent'

// Features section — 3 feature cards.
// To add a feature: add an entry to FEATURES in landingContent.js.
export default function FeaturesSection() {
  return (
    <section className="max-w-6xl mx-auto px-10 py-[72px] max-md:px-6 max-md:py-12" id="features">
      <div className="text-center mb-12">
        <h2 className="text-3xl max-md:text-2xl font-extrabold tracking-tight mb-2 text-text">Everything you need to learn your way</h2>
        <p className="text-muted text-base">Three tools. One platform. All yours.</p>
      </div>
      <div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
        {FEATURES.map(f => (
          <div key={f.title} className="bg-surface rounded-card border border-border px-6 py-7 transition-all hover:shadow-hover hover:-translate-y-0.5">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-xl mb-4"
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
