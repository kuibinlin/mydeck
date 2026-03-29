import { api } from '@/lib/apiClient'

export const getDecks = () =>
  api('/api/challenge-decks')

export const getDeck = (id) =>
  api(`/api/challenge-decks/${id}`)

export const createDeck = (data) =>
  api('/api/challenge-decks', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updateDeck = (id, data) =>
  api(`/api/challenge-decks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })

export const addCard = (deckId, data) =>
  api(`/api/challenge-decks/${deckId}/cards`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const deleteCard = (cardId) =>
  api(`/api/challenge-cards/${cardId}`, { method: 'DELETE' })

export const publish = (deckId) =>
  api(`/api/challenge-decks/${deckId}/publish`, { method: 'POST' })

export const submitScore = (data) =>
  api('/api/scores', {
    method: 'POST',
    body: JSON.stringify(data),
  })
