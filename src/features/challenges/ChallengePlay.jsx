import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import Spinner from '@/components/ui/Spinner'
import { shuffle } from '@/lib/utils'
import ProgressBar from '@/components/ui/ProgressBar'
import BackButton from '@/components/ui/BackButton'
import QuizQuestion from './QuizQuestion'
import ResultsCard from './ResultsCard'
import { getDeck, submitScore } from './challengeApi'

export default function ChallengePlay() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [deck, setDeck] = useState(null)
  const [cards, setCards] = useState([])
  const [linkedFcDecks, setLinkedFcDecks] = useState([])
  const [versionId, setVersionId] = useState(null)
  const [loading, setLoading] = useState(true)

  // quiz state
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState([])         // bool[]  — correct/wrong per question
  const [selectedAnswers, setSelectedAnswers] = useState([]) // number[] — chosen index per question
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    getDeck(id)
      .then(data => {
        setDeck(data.deck)
        setLinkedFcDecks(data.linked_flashcard_decks || [])
        if (data.version) {
          setVersionId(data.version.id)
          setCards(shuffle(data.cards))
        }
      })
      .catch(() => navigate('/challenges'))
      .finally(() => setLoading(false))
  }, [id, navigate])

  const handleAnswer = (selected) => {
    const correct = cards[index].answer
    setSelectedIndex(selected)
    setAnswered(true)

    setTimeout(() => {
      const isCorrect = selected === correct
      const newAnswers = [...answers, isCorrect]
      const newSelectedAnswers = [...selectedAnswers, selected]
      setAnswers(newAnswers)
      setSelectedAnswers(newSelectedAnswers)

      if (index + 1 >= cards.length) {
        // quiz complete
        setDone(true)
        const score = newAnswers.filter(Boolean).length
        submitScore({
          challenge_version_id: versionId,
          score,
          total: newAnswers.length,
        }).catch(() => {})
      } else {
        setIndex(i => i + 1)
        setSelectedIndex(null)
        setAnswered(false)
      }
    }, 1200)
  }

  if (loading) return <Spinner center />

  const pct = cards.length ? Math.round(((index + 1) / cards.length) * 100) : 100
  const progressLabel = done
    ? 'Complete!'
    : cards.length
    ? `Question ${index + 1} / ${cards.length}`
    : ''

  return (
    <div>
      <BackButton onClick={() => navigate('/challenges')} />

      <h2 className="text-xl font-bold mb-4">{deck?.title}</h2>

      {!versionId ? (
        <div className="text-center py-16 px-5 text-muted">
          <i className="fas fa-exclamation-circle text-5xl mb-3 block" />
          <p>This challenge has no published version yet.</p>
        </div>
      ) : done ? (
        <>
          <ProgressBar pct={100} label="Complete!" />
          <ResultsCard
            score={answers.filter(Boolean).length}
            total={answers.length}
            versionId={versionId}
            deckId={id}
            cards={cards}
            selectedAnswers={selectedAnswers}
          />
        </>
      ) : (
        <>
          <ProgressBar pct={pct} label={progressLabel} />

          {/* Study hint shown on first question */}
          {index === 0 && linkedFcDecks.length > 0 && (
            <div className="bg-surface rounded-card shadow-card p-4 mb-4 text-sm text-muted">
              <i className="fas fa-lightbulb text-warning" /> Study first?{' '}
              {linkedFcDecks.map(fd => (
                <button
                  key={fd.id}
                  className="inline-flex items-center gap-1.5 text-primary text-sm font-semibold cursor-pointer bg-transparent border-0 p-0 hover:opacity-80 transition-all ml-2"
                  onClick={() => navigate(`/flashcards/${fd.id}`)}
                >
                  {fd.title}
                </button>
              ))}
            </div>
          )}

          {cards[index] && (
            <QuizQuestion
              question={cards[index].question}
              choices={cards[index].choices}
              answer={cards[index].answer}
              onAnswer={handleAnswer}
              answered={answered}
              selectedIndex={selectedIndex}
            />
          )}
        </>
      )}
    </div>
  )
}
