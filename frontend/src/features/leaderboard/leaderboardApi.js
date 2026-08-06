import { api } from '@/lib/apiClient'

export const getLeaderboard = (versionId) =>
  api(`/api/leaderboard/${versionId}`)

export const getLeaderboardSummary = () =>
  api('/api/leaderboard-summary')
