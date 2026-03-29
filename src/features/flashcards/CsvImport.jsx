import { useState, useRef } from 'react'
import { parseCSV, downloadCSV } from '@/lib/utils'

// CSV import flow for flashcard decks
// columns: front | meaning | note (optional)
// onImport(cards): called with [{front, meaning, note}] after confirm
export default function CsvImport({ onImport }) {
  const [preview, setPreview] = useState(null) // [{front, meaning, note, _keep}]
  const inputRef = useRef()

  const downloadTemplate = () => {
    downloadCSV(
      'flashcard-template.csv',
      '# How to use: Replace the example row below with your own data.\n' +
        '# Columns: front | meaning | note (optional)\n' +
        '# Lines starting with # are ignored.\n' +
        'front,meaning,note\n' +
        '"car","a vehicle with four wheels",""\n',
    )
  }

  const handleFile = async e => {
    const file = e.target.files[0]
    if (!file) return
    const text = await file.text()
    e.target.value = ''

    const rows = parseCSV(text)
    if (rows.length < 2) {
      alert('CSV must have a header row and at least one data row.')
      return
    }

    const header = rows[0].map(h => h.toLowerCase())
    const frontIdx = header.indexOf('front')
    const meaningIdx = header.indexOf('meaning')
    const noteIdx = header.indexOf('note')

    if (frontIdx === -1 || meaningIdx === -1) {
      alert('CSV must have "front" and "meaning" columns.')
      return
    }

    const cards = rows
      .slice(1)
      .map(r => ({
        front: r[frontIdx] || '',
        meaning: r[meaningIdx] || '',
        note: noteIdx !== -1 ? (r[noteIdx] || '') : '',
        _keep: true,
      }))
      .filter(c => c.front && c.meaning)

    if (cards.length === 0) {
      alert('No valid cards found in CSV.')
      return
    }

    setPreview(cards)
  }

  const handleConfirm = () => {
    const cards = preview.filter(c => c._keep)
    onImport(cards)
    setPreview(null)
  }

  const toggleRow = i => {
    setPreview(prev => prev.map((c, idx) => idx === i ? { ...c, _keep: !c._keep } : c))
  }

  return (
    <>
      <button
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
        onClick={downloadTemplate}
      >
        <i className="fas fa-download" /> CSV Template
      </button>
      <button
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
        onClick={() => inputRef.current?.click()}
      >
        <i className="fas fa-file-import" /> Import CSV
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFile}
      />

      {preview && (
        <div className="bg-surface rounded-card shadow-card p-5 mt-4">
          <h3 className="mb-3">
            Import Preview — {preview.filter(c => c._keep).length} cards
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="px-2 py-1.5 text-left">Front</th>
                  <th className="px-2 py-1.5 text-left">Meaning</th>
                  <th className="px-2 py-1.5 text-left">Note</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {preview.map((c, i) => (
                  <tr
                    key={i}
                    className="border-b border-border"
                    style={{ opacity: c._keep ? 1 : 0.4 }}
                  >
                    <td className="px-2 py-1.5">{c.front}</td>
                    <td className="px-2 py-1.5">{c.meaning}</td>
                    <td className="px-2 py-1.5 text-muted">{c.note}</td>
                    <td className="px-2 py-1.5">
                      <button
                        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-all cursor-pointer border-0"
                        onClick={() => toggleRow(i)}
                      >
                        <i
                          className="fas fa-times"
                          style={{ color: c._keep ? 'var(--color-error)' : 'var(--color-muted)' }}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-success hover:opacity-90 text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
              onClick={handleConfirm}
            >
              <i className="fas fa-check" /> Confirm Import
            </button>
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-all cursor-pointer border-0"
              onClick={() => setPreview(null)}
            >
              <i className="fas fa-times" /> Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
