import { useNavigate } from "react-router";
import { HERO } from "../landingContent";
import HeroMockCard from "./HeroMockCard";

export default function HeroSection() {
  const navigate = useNavigate();
  return (
    <section className="relative flex items-center gap-16 max-w-6xl mx-auto px-10 py-20 pb-16 max-[900px]:flex-col max-[900px]:px-6 max-[900px]:py-12 overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_srgb,var(--color-primary)_8%,transparent)_0%,transparent_65%)]" />

      <div className="relative flex-1 max-w-2xl">
        {/* Eyebrow */}
        <span className="inline-flex items-center text-xs font-bold tracking-widest uppercase text-primary bg-primary/10 px-3 py-1.5 rounded-full mb-5">
          <i className="fas fa-layer-group" style={{ marginRight: 6 }} />
          MyDeck
        </span>

        <h1 className="text-5xl max-md:text-3xl font-extrabold leading-tight tracking-tight mb-4 bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">
          <span className="block">{HERO.headlineLine1}</span>
          <span className="block">{HERO.headlineLine2}</span>
        </h1>
        <p className="text-3xl max-md:text-base font-semibold leading-relaxed mb-8 max-w-xl bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
          {HERO.subheadline}
        </p>

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

      {/* Visual slot — swap <HeroMockCard /> with <img src="/hero.jpg" ... /> when ready */}
      <div className="relative flex-none w-[420px] max-[900px]:w-full max-[900px]:max-w-[340px] max-[900px]:mx-auto shadow-[0_8px_40px_color-mix(in_srgb,var(--color-primary)_20%,transparent)] rounded-card">
        <HeroMockCard />
      </div>
    </section>
  );
}
