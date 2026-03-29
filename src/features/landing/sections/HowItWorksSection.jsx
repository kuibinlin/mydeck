import { HOW_IT_WORKS } from '../landingContent'

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
          <div className="absolute top-9 left-[16.67%] right-[16.67%] h-px bg-border max-md:hidden" aria-hidden="true" />
          <div className="grid grid-cols-3 gap-6 relative max-md:grid-cols-1">
            {HOW_IT_WORKS.map((s) => (
              <div key={s.step} className="relative text-center px-5 py-6 ring-1 ring-border rounded-card bg-surface">
                <span className="inline-block text-5xl font-black text-primary/35 dark:text-indigo-400/60 leading-none mb-3">{s.step}</span>
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
