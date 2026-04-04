#!/usr/bin/env node
// seed-flashcards.mjs — Bulk-import flashcard decks from a CSV file into D1.
//
// Usage (run from worker/ directory):
//   node seed-flashcards.mjs --file=../data/your-file.csv --email=you@example.com
//
// CSV must have columns (in any order):
//   title, category, description, front, meaning, note
//
// Behaviour:
//   - Rows sharing the same title go into one deck.
//   - Blank description / note columns are stored as NULL.
//   - Running twice with the same CSV is safe — duplicates are skipped.

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
)

if (!args.file || !args.email) {
  console.error('Usage: node seed-flashcards.mjs --file=path/to/file.csv --email=you@example.com')
  process.exit(1)
}

// ─── CSV parser ──────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ } // escaped quote
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

function parseCSV(text) {
  const lines = text.trim().replace(/\r\n/g, '\n').split('\n')
  const headers = parseCSVLine(lines[0]).map(h => h.trim())
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = parseCSVLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()]))
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// SQL-escape single quotes.
const esc = s => s.replace(/'/g, "''")

// Normalize blank strings to null.
const nullable = s => (s && s.trim()) ? s.trim() : null

// Run a SELECT via wrangler and return the results array.
function d1Query(sql) {
  const tmp = `.tmp-query-${Date.now()}.sql`
  writeFileSync(tmp, sql, 'utf8')
  try {
    const raw = execSync(
      `npx wrangler d1 execute linsnotes-db --remote --json --file=${tmp}`,
      { encoding: 'utf8' }
    )
    // Extract JSON array from output (wrangler may print progress lines before it).
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error(`Unexpected wrangler output:\n${raw}`)
    return JSON.parse(match[0])[0].results
  } finally {
    unlinkSync(tmp)
  }
}

// ─── Step 1: resolve user ────────────────────────────────────────────────────

console.log(`Looking up user: ${args.email}`)
const userRows = d1Query(`SELECT id FROM users WHERE email = '${esc(args.email)}'`)

if (!userRows || userRows.length === 0) {
  console.error(`Error: no user found with email "${args.email}"`)
  process.exit(1)
}
const userId = userRows[0].id
console.log(`Found user id: ${userId}`)

// ─── Step 2: parse CSV ───────────────────────────────────────────────────────

const rows = parseCSV(readFileSync(args.file, 'utf8'))
if (rows.length === 0) {
  console.error('Error: CSV is empty or has no data rows.')
  process.exit(1)
}

// Validate required columns.
const required = ['title', 'category', 'front', 'meaning']
const headers = Object.keys(rows[0])
const missing = required.filter(c => !headers.includes(c))
if (missing.length) {
  console.error(`Error: CSV is missing required columns: ${missing.join(', ')}`)
  process.exit(1)
}

// Group cards by deck title (preserving insertion order).
const deckMap = new Map()
for (const row of rows) {
  const title = nullable(row.title)
  if (!title) { console.warn(`Skipping row with blank title: ${JSON.stringify(row)}`); continue }

  if (!deckMap.has(title)) {
    deckMap.set(title, {
      title,
      category: nullable(row.category) ?? '',
      description: nullable(row.description),
      cards: [],
    })
  }
  deckMap.get(title).cards.push({
    front:   nullable(row.front)   ?? '',
    meaning: nullable(row.meaning) ?? '',
    note:    nullable(row.note),
  })
}

console.log(`Parsed ${deckMap.size} unique deck(s), ${rows.length} card row(s)`)

// ─── Step 3: generate idempotent SQL ─────────────────────────────────────────

const parts = []

for (const deck of deckMap.values()) {
  const descVal  = deck.description ? `'${esc(deck.description)}'` : 'NULL'

  // Insert deck only if it doesn't already exist for this user.
  parts.push(`
INSERT INTO flashcard_decks (title, category, description, created_by)
SELECT '${esc(deck.title)}', '${esc(deck.category)}', ${descVal}, ${userId}
WHERE NOT EXISTS (
  SELECT 1 FROM flashcard_decks
  WHERE title = '${esc(deck.title)}' AND created_by = ${userId}
);`)

  for (const card of deck.cards) {
    const noteVal   = card.note ? `'${esc(card.note)}'`  : 'NULL'
    const noteCheck = card.note
      ? `AND f.note = '${esc(card.note)}'`
      : `AND f.note IS NULL`

    // Insert card only if an identical one doesn't already exist in this deck.
    parts.push(`
INSERT INTO flashcards (deck_id, front, meaning, note)
SELECT d.id, '${esc(card.front)}', '${esc(card.meaning)}', ${noteVal}
FROM flashcard_decks d
WHERE d.title = '${esc(deck.title)}' AND d.created_by = ${userId}
AND NOT EXISTS (
  SELECT 1 FROM flashcards f
  WHERE f.deck_id = d.id
    AND f.front   = '${esc(card.front)}'
    AND f.meaning = '${esc(card.meaning)}'
    ${noteCheck}
    AND f.is_deleted = 0
);`)
  }
}

// ─── Step 4: execute ─────────────────────────────────────────────────────────
// Wrap everything in a transaction so it's all-or-nothing.
// If anything fails, D1 rolls back — no partial inserts.
// The script is idempotent so just re-run on failure.

const sql = ['BEGIN;', ...parts, 'COMMIT;'].join('\n')
const sqlFile = `seed-flashcards-${Date.now()}.sql`
writeFileSync(sqlFile, sql, 'utf8')
console.log(`Generated ${parts.length} SQL statement(s)`)

try {
  console.log('Executing against D1 (remote)...')
  execSync(
    `npx wrangler d1 execute linsnotes-db --remote --file="${sqlFile}"`,
    { stdio: 'inherit' }
  )
  console.log('Done!')
} catch {
  console.error('\nFailed. Nothing was written to the database (transaction rolled back).')
  console.error('Fix the issue and re-run — the script is safe to retry.')
  process.exit(1)
} finally {
  unlinkSync(sqlFile)
}
