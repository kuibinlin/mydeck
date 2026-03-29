import { useNavigate } from 'react-router'
import { CTA } from '../landingContent'

export default function CTASection() {
  const navigate = useNavigate()
  return (
    <section className="text-center px-10 py-20 bg-primary text-white">
      <h2 className="text-4xl max-md:text-2xl font-extrabold tracking-tight mb-3">{CTA.headline}</h2>
      <p className="text-base opacity-85 mb-8 max-w-md mx-auto">{CTA.subheadline}</p>
      <button
        className="inline-flex items-center gap-2 px-6 py-3 bg-white text-primary hover:bg-white/90 text-sm font-semibold rounded-btn transition-all cursor-pointer border-0"
        onClick={() => navigate(CTA.button.to)}
      >
        {CTA.button.label}
        <i className="fas fa-arrow-right" />
      </button>
    </section>
  )
}
