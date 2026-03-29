import { HOW_IT_WORKS } from '../landingContent'

// How it works — 3 numbered steps.
// To add/remove steps: edit HOW_IT_WORKS in landingContent.js.
export default function HowItWorksSection() {
  return (
    <section className="bg-surface border-t border-b border-border" id="how-it-works">
      <div className="max-w-6xl mx-auto px-10 py-[72px] max-md:px-6 max-md:py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl max-md:text-2xl font-extrabold tracking-tight mb-2 text-text">Up and running in minutes</h2>
          <p className="text-muted text-base">No setup. No friction. Just start.</p>
        </div>
        <div className="grid grid-cols-3 gap-6 relative max-md:grid-cols-1">
          {HOW_IT_WORKS.map((s, i) => (
            <div key={s.step} className="relative text-center px-5 py-6">
              <span className="inline-block text-5xl font-black text-primary/15 leading-none mb-3">{s.step}</span>
              <h3 className="text-base font-bold mb-2 text-text">{s.title}</h3>
              <p className="text-sm text-muted leading-relaxed">{s.description}</p>
              {i < HOW_IT_WORKS.length - 1 && (
                <div className="absolute top-9 -right-4 text-border text-base z-10 max-md:hidden" aria-hidden="true">
                  <i className="fas fa-arrow-right" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
