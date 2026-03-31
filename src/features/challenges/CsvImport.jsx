import { useState, useRef } from 'react'
import { parseCSV, downloadCSV } from '@/lib/utils'

// CSV import for challenges
// columns: question | choice_a | choice_b | choice_c | choice_d | answer (A/B/C/D)
// onImport(questions): called with [{question, choices, answer}] after confirm
export default function CsvImport({ onImport }) {
  const [preview, setPreview] = useState(null)
  const [importing, setImporting] = useState(false)
  const inputRef = useRef()

  const downloadTemplate = () => {
    downloadCSV(
      'challenge-template.csv',
      '# How to use: Replace the example row below with your own questions.\n' +
        '# Columns: question | choice_a | choice_b | choice_c | choice_d | answer\n' +
        '# The answer column must be A or B or C or D.\n' +
        '# Lines starting with # are ignored.\n' +
        'question,choice_a,choice_b,choice_c,choice_d,answer\n' +
        '"What has four wheels?","Bicycle","Car","Tricycle","Scooter","B"\n',
    )
  }

  const handleFile = async e => {
    const file = e.target.files[0]
    if (!file) return
    const text = await file.text()
    e.target.value = ''

    const rows = parseCSV(text)
    if (rows.length < 2) { alert('CSV must have a header row and at least one data row.'); return }

    const header = rows[0].map(h => h.toLowerCase().replace(/\s/g, '_'))
    const qIdx = header.indexOf('question')
    const aIdx = header.indexOf('choice_a')
    const bIdx = header.indexOf('choice_b')
    const cIdx = header.indexOf('choice_c')
    const dIdx = header.indexOf('choice_d')
    const ansIdx = header.indexOf('answer')

    if ([qIdx, aIdx, bIdx, cIdx, dIdx, ansIdx].includes(-1)) {
      alert('CSV must have columns: question, choice_a, choice_b, choice_c, choice_d, answer')
      return
    }

    const answerMap = { A: 0, B: 1, C: 2, D: 3, '0': 0, '1': 1, '2': 2, '3': 3 }
    const questions = rows
      .slice(1)
      .map(r => {
        const ans = (r[ansIdx] || '').toUpperCase()
        return {
          question: r[qIdx] || '',
          choices: [r[aIdx] || '', r[bIdx] || '', r[cIdx] || '', r[dIdx] || ''],
          answer: answerMap[ans] !== undefined ? answerMap[ans] : -1,
          _keep: true,
        }
      })
      .filter(q => q.question && q.choices.every(c => c) && q.answer !== -1)

    if (questions.length === 0) {
      alert('No valid questions found. Check that answer column uses A, B, C, or D.')
      return
    }

    setPreview(questions)
  }

  const handleConfirm = async () => {
    setImporting(true)
    try {
      await onImport(preview.filter(q => q._keep))
    } finally {
      setImporting(false)
      setPreview(null)
    }
  }

  const toggleRow = i => {
    setPreview(prev => prev.map((q, idx) => idx === i ? { ...q, _keep: !q._keep } : q))
  }

  const LABELS = ['A', 'B', 'C', 'D']

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
          onClick={() => !importing && setPreview(null)}
        >
          <div
            className="bg-surface rounded-card shadow-[0_8px_32px_rgb(0_0_0/0.2)] w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
              <h3 className="font-bold text-base">
                Import Preview — {preview.filter(q => q._keep).length} of {preview.length} questions
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
              You can edit individual questions after importing if anything looks off.
            </div>

            {/* Question cards */}
            <div className="overflow-auto flex-1 px-5 py-4 flex flex-col gap-3">
              {preview.map((q, i) => (
                <div
                  key={i}
                  className="border border-border rounded-card p-4 transition-opacity"
                  style={{ opacity: q._keep ? 1 : 0.35 }}
                >
                  {/* Question header */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted">Q{i + 1}</span>
                      <p className="text-sm font-semibold">{q.question}</p>
                    </div>
                    <button
                      className="shrink-0 inline-flex items-center justify-center w-6 h-6 bg-transparent border-0 cursor-pointer rounded transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => toggleRow(i)}
                      title={q._keep ? 'Exclude this question' : 'Include this question'}
                    >
                      <i
                        className={`fas text-xs ${q._keep ? 'fa-times text-error' : 'fa-undo text-muted'}`}
                      />
                    </button>
                  </div>

                  {/* Choices grid */}
                  <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                    {q.choices.map((choice, ci) => {
                      const isCorrect = ci === q.answer
                      return (
                        <div
                          key={ci}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm border ${
                            isCorrect
                              ? 'bg-success/10 border-success/30 text-success font-semibold'
                              : 'bg-black/[0.03] dark:bg-white/[0.03] border-transparent text-text'
                          }`}
                        >
                          <span className={`text-xs font-bold w-4 shrink-0 ${isCorrect ? 'text-success' : 'text-muted'}`}>
                            {LABELS[ci]}
                          </span>
                          <span className="flex-1 leading-snug">{choice}</span>
                          {isCorrect && (
                            <i className="fas fa-check text-success shrink-0" style={{ fontSize: 11 }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
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
