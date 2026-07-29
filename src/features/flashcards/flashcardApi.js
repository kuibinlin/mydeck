import { api } from '@/lib/apiClient'

export const getDecks = () =>
  api('/api/flashcard-decks')

export const getDeck = (id) =>
  api(`/api/flashcard-decks/${id}`)

export const createDeck = (data) =>
  api('/api/flashcard-decks', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updateDeck = (id, data) =>
  api(`/api/flashcard-decks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })

export const addCard = (deckId, data) =>
  api(`/api/flashcard-decks/${deckId}/cards`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updateCard = (cardId, data) =>
  api(`/api/flashcards/${cardId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })

export const publish = (id) =>
  api(`/api/flashcard-decks/${id}/publish`, { method: 'POST' })

export const deleteDeck = (id) =>
  api(`/api/flashcard-decks/${id}`, { method: 'DELETE' })

export const deleteCard = (cardId) =>
  api(`/api/flashcards/${cardId}`, { method: 'DELETE' })
