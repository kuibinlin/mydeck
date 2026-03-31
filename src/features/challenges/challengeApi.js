import { api } from '@/lib/apiClient'

export const getDecks = () =>
  api('/api/challenge-decks')

const parseChoices = cards => cards.map(c => ({ ...c, choices: JSON.parse(c.choices) }))

export const getDeck = async (id) => {
  const data = await api(`/api/challenge-decks/${id}`)
  return {
    ...data,
    cards: data.cards ? parseChoices(data.cards) : [],
    all_cards: data.all_cards ? parseChoices(data.all_cards) : [],
  }
}

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

export const updateCard = (cardId, data) =>
  api(`/api/challenge-cards/${cardId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })

export const deleteDeck = (id) =>
  api(`/api/challenge-decks/${id}`, { method: 'DELETE' })

export const deleteCard = (cardId) =>
  api(`/api/challenge-cards/${cardId}`, { method: 'DELETE' })

export const publish = (deckId) =>
  api(`/api/challenge-decks/${deckId}/publish`, { method: 'POST' })

export const submitScore = (data) =>
  api('/api/scores', {
    method: 'POST',
    body: JSON.stringify(data),
  })
