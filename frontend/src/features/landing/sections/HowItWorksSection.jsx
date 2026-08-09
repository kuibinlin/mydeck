import { HOW_IT_WORKS } from '../landingContent'

const STEP_STYLES = [
  { bg: 'linear-gradient(135deg, #818cf828 0%, #60a5fa18 100%)', ring: '#818cf830', color: '#818cf8' },
  { bg: 'linear-gradient(135deg, #22d3ee28 0%, #67e8f918 100%)', ring: '#22d3ee30', color: '#06b6d4' },
  { bg: 'linear-gradient(135deg, #3b82f650 0%, #60a5fa35 100%)', ring: '#3b82f650', color: '#3b82f6' },
]

export default function HowItWorksSection() {
  return (
    <section className="relative overflow-hidden" id="how-it-works">
      {/* Background glow — centre */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--color-primary)_6%,transparent)_0%,transparent_65%)]" />

      <div className="relative max-w-6xl mx-auto px-10 py-[72px] max-md:px-6 max-md:py-12">
        <div className="text-center mb-12">
          <span className="inline-flex items-center text-xs font-bold tracking-widest uppercase text-primary bg-primary/10 px-3 py-1.5 rounded-full mb-4">
            <i className="fas fa-route" style={{ marginRight: 6 }} />
            How It Works
          </span>
          <h2 className="text-3xl max-md:text-2xl font-extrabold tracking-tight mb-2 bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">
            Up and running in minutes
          </h2>
          <p className="text-muted text-base">No setup. No friction. Just start.</p>
        </div>
        {/* Connector line behind steps */}
        <div className="relative">
          <div className="grid grid-cols-3 gap-6 relative max-md:grid-cols-1">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={s.step} className="relative text-center px-5 py-6 rounded-card transition-all hover:shadow-hover hover:-translate-y-0.5" style={{ background: STEP_STYLES[i].bg, boxShadow: `0 0 0 1px ${STEP_STYLES[i].ring}` }}>
                <span className="inline-block text-5xl font-black leading-none mb-3" style={{ color: STEP_STYLES[i].color }}>{s.step}</span>
                <h3 className="text-base font-bold mb-2 text-text">{s.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
