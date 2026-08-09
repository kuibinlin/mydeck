import { useNavigate } from 'react-router'
import { CTA } from '../landingContent'

export default function CTASection() {
  const navigate = useNavigate()
  return (
    <section className="relative text-center px-10 py-20 overflow-hidden">
      {/* Centre glow for depth */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--color-primary)_8%,transparent)_0%,transparent_60%)]" />

      <div className="relative">
        <h2 className="text-3xl max-md:text-2xl font-extrabold tracking-tight mb-3 bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">{CTA.headline}</h2>
        <p className="text-base text-muted mb-8 max-w-md mx-auto">{CTA.subheadline}</p>
        <button
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white text-sm font-semibold rounded-btn transition-all cursor-pointer border-0 shadow-lg"
          onClick={() => navigate(CTA.button.to)}
        >
          {CTA.button.label}
          <i className="fas fa-arrow-right" />
        </button>
        <p className="mt-4 text-xs text-muted/60">Free to use · No credit card required</p>
      </div>
    </section>
  )
}
