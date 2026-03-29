import { useState } from 'react'

// Inline form for adding a new card
// onSave(front, meaning, note): called on save
// onCancel: called on cancel
export default function FlashcardCardForm({ onSave, onCancel }) {
  const [front, setFront] = useState('')
  const [meaning, setMeaning] = useState('')
  const [note, setNote] = useState('')

  const handleSave = () => {
    if (!front.trim() || !meaning.trim()) {
      alert('Front and meaning are required')
      return
    }
    onSave(front.trim(), meaning.trim(), note.trim() || null)
  }

  return (
    <div className="bg-surface rounded-card shadow-card p-4 mb-3">
      <div className="mb-3">
        <label className="block text-sm font-semibold mb-1.5 text-text">
          Front
        </label>
        <input
          type="text"
          placeholder="Term or word"
          value={front}
          onChange={e => setFront(e.target.value)}
          autoFocus
        />
      </div>
      <div className="mb-3">
        <label className="block text-sm font-semibold mb-1.5 text-text">
          Meaning
        </label>
        <input
          type="text"
          placeholder="Answer or definition"
          value={meaning}
          onChange={e => setMeaning(e.target.value)}
        />
      </div>
      <div className="mb-3">
        <label className="block text-sm font-semibold mb-1.5 text-text">
          Note (optional)
        </label>
        <input
          type="text"
          placeholder="Extra info, example, pronunciation"
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
        />
      </div>
      <div className="flex gap-2">
        <button
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-success hover:opacity-90 text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
          onClick={handleSave}
        >
          <i className="fas fa-check" /> Save
        </button>
        <button
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-all cursor-pointer border-0"
          onClick={onCancel}
        >
          <i className="fas fa-times" /> Cancel
        </button>
      </div>
    </div>
  )
}
