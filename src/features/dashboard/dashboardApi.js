import { api } from '@/lib/apiClient'

export const getLeaderboardSummary = () =>
  api('/api/leaderboard-summary')

export const getFlashcardDecks = () =>
  api('/api/flashcard-decks')

export const getChallengeDecks = () =>
  api('/api/challenge-decks')
