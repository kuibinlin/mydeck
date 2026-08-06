export const CATEGORIES = [
  'Language',
  'Science',
  'Mathematics',
  'History & Geography',
  'Arts & Literature',
  'Medical & Health',
  'Computer Science',
  'ML & Deep Learning',
  'Business & Economics',
  'Law & Government',
  'Trivia & Fun',
  'Other',
]

export const DEFAULT_CATEGORY = 'Language'
export const MAX_CARDS_PER_DECK = 50

// Flashcard decks and challenge decks share one publish threshold so the
// create → fill → publish flow reads the same for both. Mirrors
// MIN_ITEMS_TO_PUBLISH in backend/src/services/constants.js — the worker is
// authoritative; this copy only drives button state and copy.
export const MIN_ITEMS_TO_PUBLISH = 3
