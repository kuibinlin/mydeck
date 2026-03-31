import { useState, useRef } from 'react'
import { parseCSV, downloadCSV } from '@/lib/utils'

// CSV import flow for flashcard decks
// columns: front | meaning | note (optional)
// onImport(cards): called with [{front, meaning, note}] after confirm
export default function CsvImport({ onImport }) {
  const [preview, setPreview] = useState(null) // [{front, meaning, note, _keep}]
  const [importing, setImporting] = useState(false)
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

  const handleConfirm = async () => {
    setImporting(true)
    try {
      await onImport(preview.filter(c => c._keep))
    } finally {
      setImporting(false)
      setPreview(null)
    }
  }

  const toggleRow = i => {
    setPreview(prev => prev.map((c, idx) => idx === i ? { ...c, _keep: !c._keep } : c))
  }

  return (
    <>
      <button
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-transparent text-primary border border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer"
        onClick={downloadTemplate}
      >
        <i className="fas fa-download" /> CSV Template
      </button>
      <button
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-transparent text-primary border border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer"
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
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-surface rounded-card shadow-[0_8px_32px_rgb(0_0_0/0.2)] w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
              <h3 className="font-bold text-base">
                Import Preview — {preview.filter(c => c._keep).length} of {preview.length} cards
              </h3>
              <button
                className="inline-flex items-center justify-center w-7 h-7 text-muted hover:text-text bg-transparent border-0 cursor-pointer rounded-btn transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setPreview(null)}
                disabled={importing}
              >
                <i className="fas fa-times" />
              </button>
            </div>

            {/* Hint */}
            <div className="px-5 py-2.5 bg-primary/5 border-b border-border shrink-0 flex items-center gap-2 text-xs text-muted">
              <i className="fas fa-info-circle text-primary shrink-0" />
              You can edit individual cards after importing if anything looks off.
            </div>

            <div className="overflow-auto flex-1 px-5 py-3">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="px-2 py-1.5 text-left font-semibold">Front</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Meaning</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Note</th>
                    <th className="px-2 py-1.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {preview.map((c, i) => (
                    <tr
                      key={i}
                      className="border-b border-border transition-opacity"
                      style={{ opacity: c._keep ? 1 : 0.35 }}
                    >
                      <td className="px-2 py-2">{c.front}</td>
                      <td className="px-2 py-2">{c.meaning}</td>
                      <td className="px-2 py-2 text-muted">{c.note}</td>
                      <td className="px-2 py-2 text-center">
                        <button
                          className="inline-flex items-center justify-center w-6 h-6 bg-transparent border-0 cursor-pointer rounded transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                          onClick={() => toggleRow(i)}
                          title={c._keep ? 'Exclude row' : 'Include row'}
                        >
                          <i
                            className={`fas ${c._keep ? 'fa-times text-error' : 'fa-undo text-muted'}`}
                            style={{ fontSize: 11 }}
                          />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-border shrink-0">
              <button
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-success hover:opacity-90 text-white font-semibold rounded-btn transition-all cursor-pointer border-0 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleConfirm}
                disabled={importing}
              >
                {importing
                  ? <><i className="fas fa-spinner fa-spin" /> Importing…</>
                  : <><i className="fas fa-check" /> Confirm Import</>
                }
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-colors cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setPreview(null)}
                disabled={importing}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
