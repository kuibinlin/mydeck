import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import Spinner from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import { CATEGORIES, DEFAULT_CATEGORY } from '@/lib/constants'
import FlashcardCardForm from './FlashcardCardForm'
import CsvImport from './CsvImport'
import { getDeck, createDeck, updateDeck, deleteDeck, addCard, updateCard, deleteCard } from './flashcardApi'

export default function FlashcardEdit() {
  const { id } = useParams() // undefined when creating
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [deckId, setDeckId] = useState(id || null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(DEFAULT_CATEGORY)
  const [description, setDescription] = useState('')
  const [cards, setCards] = useState([])
  const [showCardForm, setShowCardForm] = useState(false)
  const [editingCard, setEditingCard] = useState(null)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [deckSaved, setDeckSaved] = useState(isEdit)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  useEffect(() => {
    if (!isEdit) return
    getDeck(id)
      .then(data => {
        setTitle(data.deck.title)
        setCategory(data.deck.category)
        setDescription(data.deck.description || '')
        setCards(data.cards)
      })
      .catch(err => { alert(err.message); navigate('/flashcards') })
      .finally(() => setLoading(false))
  }, [id, isEdit, navigate])

  const refreshCards = () =>
    getDeck(deckId).then(data => setCards(data.cards)).catch(() => {})

  const handleSaveDeck = async () => {
    if (!title.trim()) { setMsg({ type: 'error', text: 'Title is required' }); return }
    setSaving(true)
    setMsg(null)
    try {
      if (deckId) {
        await updateDeck(deckId, { title, category, description })
        setMsg({ type: 'success', text: 'Deck updated!' })
      } else {
        const data = await createDeck({ title, category, description })
        setDeckId(data.id)
        setDeckSaved(true)
        setMsg({ type: 'success', text: 'Deck created! Now add cards below.' })
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveCard = async (front, meaning, note) => {
    try {
      await addCard(deckId, { front, meaning, note })
      setShowCardForm(false)
      refreshCards()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleUpdateCard = async (front, meaning, note) => {
    try {
      await updateCard(editingCard.id, { front, meaning, note })
      setEditingCard(null)
      refreshCards()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleDeleteCard = async (cardId) => {
    if (!confirm('Delete this card?')) return
    try {
      await deleteCard(cardId)
      refreshCards()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleDeleteDeck = async () => {
    try {
      await deleteDeck(deckId)
      navigate('/flashcards')
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
      setShowDeleteModal(false)
    }
  }

  const handleCsvImport = async (importedCards) => {
    for (const c of importedCards) {
      try {
        await addCard(deckId, { front: c.front, meaning: c.meaning, note: c.note || null })
      } catch { /* skip invalid rows */ }
    }
    refreshCards()
  }

  if (loading) return <Spinner center />

  return (
    <div>
      <button
        className="inline-flex items-center gap-1.5 text-primary text-sm font-semibold mb-4 cursor-pointer bg-transparent border-0 p-0 hover:opacity-80 transition-all"
        onClick={() => navigate('/flashcards')}
      >
        <i className="fas fa-arrow-left" /> Back
      </button>

      <h2 className="text-xl font-bold mb-4">
        {isEdit ? 'Edit Flashcards' : 'Create Flashcards'}
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
              placeholder="e.g. Japanese N5 Basics"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-semibold mb-1.5 text-text">
              Category
            </label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
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
            placeholder="What is this deck about?"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
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
          {isEdit && (
            <button
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm bg-transparent text-error hover:bg-error hover:text-white font-semibold rounded-btn transition-all cursor-pointer border border-error"
              onClick={() => setShowDeleteModal(true)}
            >
              <i className="fas fa-trash" /> Delete Deck
            </button>
          )}
        </div>
      </div>

      {/* Card editor — shown only after deck is created */}
      {deckSaved && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Cards</h2>
            <div className="flex gap-2 flex-wrap">
              <CsvImport onImport={handleCsvImport} />
              <button
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-primary hover:bg-primary-hover text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
                onClick={() => { setEditingCard(null); setShowCardForm(true) }}
              >
                <i className="fas fa-plus" /> Add Card
              </button>
            </div>
          </div>

          {showCardForm && (
            <FlashcardCardForm
              onSave={handleSaveCard}
              onCancel={() => setShowCardForm(false)}
            />
          )}

          {cards.length === 0 && !showCardForm && (
            <div className="text-center py-16 px-5 text-muted">
              <i className="fas fa-plus-circle text-5xl mb-3 block" />
              <p>No cards yet. Add your first card!</p>
            </div>
          )}

          {cards.map((c, i) => (
            editingCard?.id === c.id ? (
              <FlashcardCardForm
                key={c.id}
                initialValues={c}
                onSave={handleUpdateCard}
                onCancel={() => setEditingCard(null)}
              />
            ) : (
              <div
                key={c.id}
                className="bg-surface rounded-card shadow-card p-4 mb-3"
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-bold text-sm text-muted">
                    Card {i + 1}
                  </span>
                  <div className="flex gap-1">
                    <button
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-all cursor-pointer border-0"
                      onClick={() => { setShowCardForm(false); setEditingCard(c) }}
                    >
                      <i className="fas fa-pencil-alt" />
                    </button>
                    <button
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-all cursor-pointer border-0"
                      onClick={() => handleDeleteCard(c.id)}
                    >
                      <i className="fas fa-trash text-error" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                  <div>
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Front</div>
                    <div className="text-sm font-semibold">{c.front}</div>
                  </div>
                  <div className="border-l border-border pl-3 max-sm:border-l-0 max-sm:pl-0 max-sm:border-t max-sm:pt-3">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Back</div>
                    <div className="text-sm">{c.meaning}</div>
                    {c.note && (
                      <div className="text-xs text-muted mt-2 pt-2 border-t border-border">
                        {c.note}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          ))}
        </>
      )}
      <Modal
        open={showDeleteModal}
        title="Delete deck?"
        message="This will permanently delete the deck and all its cards. This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteDeck}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  )
}
