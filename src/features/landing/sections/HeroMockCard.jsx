import { useState, useEffect } from 'react'

const CARDS = [
  { front: 'What is React?', back: 'A JavaScript library for building user interfaces.' },
  { front: 'What is a Hook?', back: 'Functions that let you use state in function components.' },
  { front: 'What is JSX?', back: 'HTML-like syntax that compiles to JavaScript.' },
]

export default function HeroMockCard() {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const flipTimer = setTimeout(() => setFlipped(true), 1500)
    const fadeTimer = setTimeout(() => setFading(true), 3000)
    const nextTimer = setTimeout(() => {
      setFading(false)
      setFlipped(false)
      setIndex(i => (i + 1) % CARDS.length)
    }, 3600)

    return () => {
      clearTimeout(flipTimer)
      clearTimeout(fadeTimer)
      clearTimeout(nextTimer)
    }
  }, [index])

  const card = CARDS[index]
  const progress = Math.round(((index + 1) / CARDS.length) * 100)

  return (
    <div className="w-full aspect-[4/3] rounded-card shadow-card flex flex-col gap-4 p-6" style={{ background: 'linear-gradient(135deg, #818cf8 0%, #22d3ee 100%)' }}>
      {/* Flip card */}
      <div style={{ perspective: '1000px', flex: 1, opacity: fading ? 0 : 1, transition: 'opacity 0.5s ease' }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            transformStyle: 'preserve-3d',
            transition: 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* Front — question */}
          <div
            style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)' }}
            className="rounded-xl flex flex-col items-center justify-center gap-3 px-6"
          >
            <p className="text-base font-semibold text-white text-center">{card.front}</p>
            <span className="text-xs text-white/60 tracking-wide">flip to reveal →</span>
          </div>

          {/* Back — answer */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              background: 'rgba(255,255,255,0.22)',
              border: '1px solid rgba(255,255,255,0.3)',
            }}
            className="rounded-xl flex flex-col items-center justify-center gap-2 px-6"
          >
            <p className="text-sm text-white text-center leading-relaxed">{card.back}</p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-white/70">
          <span>Card {index + 1} of {CARDS.length}</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.25)' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: 'rgba(255,255,255,0.85)' }} />
        </div>
      </div>
    </div>
  )
}
