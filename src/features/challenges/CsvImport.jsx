import { useState, useRef } from 'react'
import { parseCSV, downloadCSV } from '@/lib/utils'

// CSV import for challenges
// columns: question | choice_a | choice_b | choice_c | choice_d | answer (A/B/C/D)
// onImport(questions): called with [{question, choices, answer}] after confirm
export default function CsvImport({ onImport }) {
  const [preview, setPreview] = useState(null)
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

  const handleConfirm = () => {
    onImport(preview.filter(q => q._keep))
    setPreview(null)
  }

  const toggleRow = i => {
    setPreview(prev => prev.map((q, idx) => idx === i ? { ...q, _keep: !q._keep } : q))
  }

  const labels = ['A', 'B', 'C', 'D']

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
            Import Preview — {preview.filter(q => q._keep).length} questions
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="px-2 py-1.5 text-left">Question</th>
                  {labels.map(l => (
                    <th key={l} className="px-2 py-1.5 text-left">{l}</th>
                  ))}
                  <th className="px-2 py-1.5">Ans</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {preview.map((q, i) => (
                  <tr
                    key={i}
                    className="border-b border-border"
                    style={{ opacity: q._keep ? 1 : 0.4 }}
                  >
                    <td className="px-2 py-1.5">{q.question}</td>
                    {q.choices.map((c, ci) => (
                      <td
                        key={ci}
                        className="px-2 py-1.5"
                        style={{
                          fontWeight: ci === q.answer ? 600 : 'normal',
                          color: ci === q.answer ? 'var(--color-success)' : 'inherit',
                        }}
                      >
                        {c}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center font-semibold">
                      {labels[q.answer]}
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-all cursor-pointer border-0"
                        onClick={() => toggleRow(i)}
                      >
                        <i
                          className="fas fa-times"
                          style={{ color: q._keep ? 'var(--color-error)' : 'var(--color-muted)' }}
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
