import { useState } from 'react'

// onSave({ question, choices, answer }): called on save
// onCancel
// initialValues: if provided, form starts pre-filled (edit mode)
export default function QuestionForm({ onSave, onCancel, initialValues }) {
  const [question, setQuestion] = useState(initialValues?.question ?? '')
  const [choices, setChoices] = useState(initialValues?.choices ?? ['', '', '', ''])
  const [answer, setAnswer] = useState(initialValues?.answer ?? 0)

  const isEditing = initialValues != null

  const setChoice = (i, val) =>
    setChoices(prev => prev.map((c, idx) => (idx === i ? val : c)))

  const handleSave = () => {
    if (!question.trim() || choices.some(c => !c.trim())) {
      alert('Question and all 4 choices are required')
      return
    }
    onSave({ question: question.trim(), choices, answer })
  }

  return (
    <div className="bg-surface rounded-card shadow-card p-4 mb-3">
      <div className="mb-3">
        <label className="block text-sm font-semibold mb-1.5 text-text">
          Question
        </label>
        <input
          type="text"
          placeholder="What is…?"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          autoFocus
        />
      </div>

      {['A', 'B', 'C', 'D'].map((label, i) => (
        <div key={i} className="mb-3">
          <label className="block text-sm font-semibold mb-1.5 text-text">
            Choice {label}
          </label>
          <input
            type="text"
            placeholder={`Choice ${label}`}
            value={choices[i]}
            onChange={e => setChoice(i, e.target.value)}
          />
        </div>
      ))}

      <div className="mb-3">
        <label className="block text-sm font-semibold mb-1.5 text-text">
          Correct Answer
        </label>
        <select value={answer} onChange={e => setAnswer(Number(e.target.value))}>
          {['A', 'B', 'C', 'D'].map((l, i) => (
            <option key={i} value={i}>{l}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-success hover:opacity-90 text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
          onClick={handleSave}
        >
          <i className="fas fa-check" /> {isEditing ? 'Update' : 'Save'}
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
