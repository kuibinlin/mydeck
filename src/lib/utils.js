// strip HTML to prevent XSS when rendering user content as text
export function escapeHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// robust CSV parser — handles quoted fields, BOM, comment lines, CRLF
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  text = text
    .split('\n')
    .filter(l => !l.trimStart().startsWith('#'))
    .join('\n')

  const rows = []
  let current = ''
  let inQuotes = false
  let row = []

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { current += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else { current += ch }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === ',') { row.push(current.trim()); current = '' }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(current.trim()); current = ''
        if (row.some(c => c)) rows.push(row)
        row = []
        if (ch === '\r') i++
      } else { current += ch }
    }
  }
  row.push(current.trim())
  if (row.some(c => c)) rows.push(row)
  return rows
}

// trigger a CSV file download in the browser
export function downloadCSV(filename, content) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}

export function truncateText(str, maxLen = 60) {
  if (!str || str.length <= maxLen) return str
  return str.slice(0, maxLen) + '\u2026'
}

export function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString()
}
