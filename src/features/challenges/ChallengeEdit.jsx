import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import Spinner from '@/components/ui/Spinner'
import { CATEGORIES, DEFAULT_CATEGORY } from '@/lib/constants'
import { getDecks as getFcDecks } from '@/features/flashcards/flashcardApi'
import QuestionForm from './QuestionForm'
import CsvImport from './CsvImport'
import { getDeck, createDeck, updateDeck, addCard, deleteCard, publish } from './challengeApi'

export default function ChallengeEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [deckId, setDeckId] = useState(id || null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(DEFAULT_CATEGORY)
  const [description, setDescription] = useState('')
  const [linkedFcId, setLinkedFcId] = useState('')
  const [fcDecks, setFcDecks] = useState([])
  const [cards, setCards] = useState([])
  const [showQuestionForm, setShowQuestionForm] = useState(false)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [deckSaved, setDeckSaved] = useState(isEdit)

  useEffect(() => {
    // load flashcard decks for the link dropdown
    getFcDecks().then(d => setFcDecks(d.decks)).catch(() => {})

    if (!isEdit) return
    getDeck(id)
      .then(data => {
        setTitle(data.deck.title)
        setCategory(data.deck.category)
        setDescription(data.deck.description || '')
        if (data.linked_flashcard_decks?.length > 0) {
          setLinkedFcId(String(data.linked_flashcard_decks[0].id))
        }
        setCards(data.all_cards || [])
      })
      .catch(err => { alert(err.message); navigate('/challenges') })
      .finally(() => setLoading(false))
  }, [id, isEdit, navigate])

  const refreshCards = () =>
    getDeck(deckId).then(data => setCards(data.all_cards || [])).catch(() => {})

  const handleSaveDeck = async () => {
    if (!title.trim()) { setMsg({ type: 'error', text: 'Title is required' }); return }
    setSaving(true)
    setMsg(null)
    try {
      if (deckId) {
        await updateDeck(deckId, { title, category, description })
        setMsg({ type: 'success', text: 'Deck updated!' })
      } else {
        const data = await createDeck({
          title,
          category,
          description,
          linked_flashcard_deck_id: linkedFcId || null,
        })
        setDeckId(data.id)
        setDeckSaved(true)
        setMsg({ type: 'success', text: 'Deck created! Now add questions below.' })
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveQuestion = async ({ question, choices, answer }) => {
    try {
      await addCard(deckId, { question, choices, answer })
      setShowQuestionForm(false)
      refreshCards()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleDeleteQuestion = async (cardId) => {
    if (!confirm('Delete this question?')) return
    try {
      await deleteCard(cardId)
      refreshCards()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleCsvImport = async (questions) => {
    for (const q of questions) {
      try {
        await addCard(deckId, { question: q.question, choices: q.choices, answer: q.answer })
      } catch { /* skip invalid rows */ }
    }
    refreshCards()
  }

  const handlePublish = async () => {
    if (!confirm('Publish a new version? This creates a new leaderboard.')) return
    try {
      const data = await publish(deckId)
      alert(`Published version ${data.version} with ${data.card_count} questions!`)
      navigate('/challenges')
    } catch (err) {
      alert(err.message)
    }
  }

  if (loading) return <Spinner center />

  return (
    <div>
      <button
        className="inline-flex items-center gap-1.5 text-primary text-sm font-semibold mb-4 cursor-pointer bg-transparent border-0 p-0 hover:opacity-80 transition-all"
        onClick={() => navigate('/challenges')}
      >
        <i className="fas fa-arrow-left" /> Back
      </button>

      <h2 className="text-xl font-bold mb-4">
        {isEdit ? 'Edit Challenge' : 'Create Challenge'}
      </h2>

      {msg && (
        <div className={msg.type === 'error'
          ? 'p-2.5 px-3.5 rounded-lg mb-4 text-sm bg-red-100 text-red-700 dark:bg-red-900/15 dark:text-[#ff6b6b]'
          : 'p-2.5 px-3.5 rounded-lg mb-4 text-sm bg-green-100 text-green-700 dark:bg-green-900/15 dark:text-[#6ee7a0]'
        }>
          {msg.text}
        </div>
      )}

      {/* Deck metadata */}
      <div className="bg-surface rounded-card shadow-card p-5 mb-4">
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-sm font-semibold mb-1.5 text-text">
              Deck Title
            </label>
            <input
              type="text"
              placeholder="e.g. Japanese N5 Quiz"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-semibold mb-1.5 text-text">
              Category
            </label>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold mb-1.5 text-text">
            Description (optional)
          </label>
          <input
            type="text"
            placeholder="What is this challenge about?"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        {!isEdit && (
          <div className="mb-4">
            <label className="block text-sm font-semibold mb-1.5 text-text">
              Link to Flashcard Deck (optional)
            </label>
            <select value={linkedFcId} onChange={e => setLinkedFcId(e.target.value)}>
              <option value="">No link</option>
              {fcDecks.map(d => <option key={d.id} value={String(d.id)}>{d.title}</option>)}
            </select>
          </div>
        )}

        <button
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm bg-primary hover:bg-primary-hover text-white font-semibold rounded-btn transition-all cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSaveDeck}
          disabled={saving}
        >
          {isEdit
            ? <><i className="fas fa-save" /> Update</>
            : <><i className="fas fa-check" /> Confirm</>
          }
        </button>
      </div>

      {/* Question editor */}
      {deckSaved && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Questions</h2>
            <div className="flex gap-2 flex-wrap">
              <CsvImport onImport={handleCsvImport} />
              <button
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-primary hover:bg-primary-hover text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
                onClick={() => setShowQuestionForm(true)}
              >
                <i className="fas fa-plus" /> Add Question
              </button>
            </div>
          </div>

          {showQuestionForm && (
            <QuestionForm
              onSave={handleSaveQuestion}
              onCancel={() => setShowQuestionForm(false)}
            />
          )}

          {cards.length === 0 && !showQuestionForm && (
            <div className="text-center py-16 px-5 text-muted">
              <i className="fas fa-plus-circle text-5xl mb-3 block" />
              <p>No questions yet. Add your first question!</p>
            </div>
          )}

          {cards.map((c, i) => {
            const choices = JSON.parse(c.choices)
            return (
              <div
                key={c.id}
                className="bg-surface rounded-card shadow-card p-4 mb-3"
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-bold text-sm text-muted">
                    Q{i + 1}
                  </span>
                  <button
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-all cursor-pointer border-0"
                    onClick={() => handleDeleteQuestion(c.id)}
                  >
                    <i className="fas fa-trash text-error" />
                  </button>
                </div>
                <strong>{c.question}</strong>
                <div className="mt-1.5 text-sm">
                  {choices.map((ch, ci) => (
                    <span key={ci} className="mr-3">
                      {ci === c.answer && (
                        <span className="bg-success/15 text-success px-2 py-0.5 rounded text-xs font-semibold mr-1">
                          ✓
                        </span>
                      )}
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}

          {cards.length > 0 && (
            <button
              className="w-full inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm bg-success hover:opacity-90 text-white font-semibold rounded-btn transition-all cursor-pointer border-0 mt-4"
              onClick={handlePublish}
            >
              <i className="fas fa-rocket" /> Publish Version
            </button>
          )}
        </>
      )}
    </div>
  )
}
