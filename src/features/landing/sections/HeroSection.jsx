import { useNavigate } from 'react-router'
import { HERO } from '../landingContent'

// Hero section — first thing visitors see.
// Visual slot is intentionally empty for now (text-only).
// To add a graphic/screenshot later, drop it into the visual div.
export default function HeroSection() {
  const navigate = useNavigate()
  return (
    <section className="flex items-center gap-16 max-w-6xl mx-auto px-10 py-20 pb-16 max-[900px]:flex-col max-[900px]:px-6 max-[900px]:py-12">
      <div className="flex-1 max-w-2xl">
        {/* Eyebrow */}
        <span className="inline-flex items-center text-xs font-bold tracking-widest uppercase text-primary bg-primary/10 px-3 py-1.5 rounded-full mb-5">
          <i className="fas fa-layer-group" style={{ marginRight: 6 }} />
          MyDeck
        </span>

        <h1 className="text-5xl max-md:text-3xl font-extrabold leading-tight tracking-tight mb-4 text-text">{HERO.headline}</h1>
        <p className="text-lg text-muted leading-relaxed mb-8 max-w-xl">{HERO.subheadline}</p>

        <div className="flex gap-3 flex-wrap">
          <button
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-btn transition-all cursor-pointer border-0 bg-primary hover:bg-primary-hover text-white"
            onClick={() => navigate(HERO.ctaPrimary.to)}
          >
            {HERO.ctaPrimary.label}
            <i className="fas fa-arrow-right" />
          </button>
          <button
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-btn transition-all cursor-pointer border-0 bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white"
            onClick={() => navigate(HERO.ctaSecondary.to)}
          >
            {HERO.ctaSecondary.label}
          </button>
        </div>
      </div>

      {/* Visual slot — replace the placeholder with a screenshot or graphic later */}
      <div className="flex-none w-[420px] max-[900px]:hidden">
        <div className="w-full aspect-[4/3] bg-surface rounded-card shadow-card border border-border flex items-center justify-center">
          <i className="fas fa-layer-group" style={{ fontSize: '4rem', color: 'var(--color-primary)', opacity: 0.15 }} />
        </div>
      </div>
    </section>
  )
}
