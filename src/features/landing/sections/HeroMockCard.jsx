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
    <div className="w-full aspect-[4/3] bg-surface rounded-card shadow-card border border-border flex flex-col gap-4 p-6">
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
            style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            className="bg-background rounded-xl border border-border flex flex-col items-center justify-center gap-3 px-6"
          >
            <p className="text-base font-semibold text-text text-center">{card.front}</p>
            <span className="text-xs text-muted/60 tracking-wide">flip to reveal →</span>
          </div>

          {/* Back — answer */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
            className="bg-primary/5 rounded-xl border border-primary/20 flex flex-col items-center justify-center gap-2 px-6"
          >
            <p className="text-sm text-text text-center leading-relaxed">{card.back}</p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-muted">
          <span>Card {index + 1} of {CARDS.length}</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}
