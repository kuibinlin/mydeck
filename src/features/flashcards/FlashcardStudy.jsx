import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import Spinner from '@/components/ui/Spinner'
import ProgressBar from '@/components/ui/ProgressBar'
import FlashcardCard from './FlashcardCard'
import { getDeck } from './flashcardApi'

export default function FlashcardStudy() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [deck, setDeck] = useState(null)
  const [cards, setCards] = useState([])
  const [originalCards, setOriginalCards] = useState([])
  const [linkedChallenges, setLinkedChallenges] = useState([])
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [shuffled, setShuffled] = useState(() => localStorage.getItem('md_shuffle') === 'true')

  useEffect(() => {
    getDeck(id)
      .then(data => {
        setDeck(data.deck)
        setOriginalCards(data.cards)
        setCards(
          localStorage.getItem('md_shuffle') === 'true'
            ? [...data.cards].sort(() => Math.random() - 0.5)
            : data.cards
        )
        setLinkedChallenges(data.linked_challenges || [])
      })
      .catch(err => { alert(err.message); navigate('/flashcards') })
      .finally(() => setLoading(false))
  }, [id, navigate])

  const toggleShuffle = () => {
    const next = !shuffled
    setShuffled(next)
    localStorage.setItem('md_shuffle', String(next))
    setIndex(0)
    setFlipped(false)
    setCards(next
      ? [...originalCards].sort(() => Math.random() - 0.5)
      : originalCards
    )
  }

  const flip = useCallback(() => setFlipped(f => !f), [])
  const next = useCallback(() => {
    if (index < cards.length - 1) { setIndex(i => i + 1); setFlipped(false) }
  }, [index, cards.length])
  const prev = useCallback(() => {
    if (index > 0) { setIndex(i => i - 1); setFlipped(false) }
  }, [index])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip() }
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flip, next, prev])

  if (loading) return <Spinner center />

  const card = cards[index]
  const pct = cards.length ? Math.round(((index + 1) / cards.length) * 100) : 0

  return (
    <div>
      <button
        className="inline-flex items-center gap-1.5 text-primary text-sm font-semibold mb-4 cursor-pointer bg-transparent border-0 p-0 hover:opacity-80 transition-all"
        onClick={() => navigate('/flashcards')}
      >
        <i className="fas fa-arrow-left" /> Back
      </button>

      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold">{deck?.title}</h2>
        <button
          onClick={toggleShuffle}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-btn transition-all cursor-pointer border ${shuffled ? 'bg-primary text-white border-primary' : 'bg-transparent text-muted border-border hover:border-primary hover:text-primary'}`}
        >
          <i className="fas fa-random" /> Shuffle
        </button>
      </div>
      {shuffled && (
        <p className="text-xs text-muted mb-3">
          <i className="fas fa-check-circle text-success mr-1" />
          Shuffle on · preference saved for next time
        </p>
      )}
      {!shuffled && <div className="mb-4" />}

      {cards.length === 0 ? (
        <div className="text-center py-16 px-5 text-muted">
          <i className="fas fa-layer-group text-5xl mb-3 block" />
          <p>No cards in this deck yet.</p>
        </div>
      ) : (
        <>
          <ProgressBar
            pct={pct}
            label={`${index + 1} / ${cards.length}`}
          />

          <FlashcardCard
            front={card.front}
            meaning={card.meaning}
            note={card.note}
            flipped={flipped}
            onClick={flip}
          />

          <div className="flex justify-center gap-3 mt-4">
            <button
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={prev}
              disabled={index === 0}
            >
              <i className="fas fa-arrow-left" /> Prev
            </button>
            <button
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm bg-primary hover:bg-primary-hover text-white font-semibold rounded-btn transition-all cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={next}
              disabled={index === cards.length - 1}
            >
              Next <i className="fas fa-arrow-right" />
            </button>
          </div>
        </>
      )}

      {/* Linked challenges */}
      {linkedChallenges.length > 0 && (
        <div className="bg-surface rounded-card shadow-card p-5 mt-6">
          <h3 className="mb-2">
            <i className="fas fa-trophy text-primary mr-1.5" />
            Related Challenges
          </h3>
          {linkedChallenges.map(c => (
            <button
              key={c.id}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer border-0 mt-2 mr-2"
              onClick={() => navigate(`/challenges/${c.id}`)}
            >
              {c.title} <i className="fas fa-arrow-right" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
