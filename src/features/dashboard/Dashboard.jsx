import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '@/context/AuthContext'
import Spinner from '@/components/ui/Spinner'
import HeroCard from './HeroCard'
import { getLeaderboardSummary, getFlashcardDecks, getChallengeDecks } from './dashboardApi'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [fcCount, setFcCount] = useState(null)
  const [chCount, setChCount] = useState(null)
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  useEffect(() => {
    getFlashcardDecks()
      .then(d => setFcCount(d.decks.length))
      .catch(() => {})

    getChallengeDecks()
      .then(d => setChCount(d.decks.length))
      .catch(() => {})

    getLeaderboardSummary()
      .then(d => setSummary(d.summary))
      .catch(() => setSummary([]))
      .finally(() => setSummaryLoading(false))
  }, [])

  const countLabel = (n, noun) => {
    if (n === null) return ''
    return `${n} ${noun}${n !== 1 ? 's' : ''}`
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <p className="text-muted mb-4 text-sm">
        Welcome back, {user?.username}
      </p>

      {/* Hero cards */}
      <div className="flex gap-4 mb-6 max-sm:flex-col">
        <HeroCard
          icon="fas fa-layer-group"
          title="Flashcards"
          count={countLabel(fcCount, 'deck')}
          accentColor="var(--color-primary)"
          to="/flashcards"
        />
        <HeroCard
          icon="fas fa-trophy"
          title="Challenges"
          count={countLabel(chCount, 'deck')}
          accentColor="var(--color-warning)"
          to="/challenges"
        />
      </div>

      {/* Leaderboard summary */}
      {summaryLoading ? (
        <Spinner center />
      ) : summary && summary.length === 0 ? (
        <div className="bg-surface rounded-card shadow-card p-6 text-center">
          <i className="fas fa-trophy text-3xl text-muted mb-2 block" />
          <p className="text-muted">
            No leaderboard data yet. Create a challenge and play!
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-card shadow-card p-5 overflow-x-auto">
          <h3 className="mb-3">
            <i className="fas fa-trophy text-warning mr-1.5" />
            Leaderboards
          </h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border text-left">
                <th className="px-3 py-2">Challenge</th>
                <th className="px-3 py-2 text-center">1st</th>
                <th className="px-3 py-2 text-center">2nd</th>
                <th className="px-3 py-2 text-center">3rd</th>
              </tr>
            </thead>
            <tbody>
              {summary?.map(s => (
                <tr
                  key={s.version_id}
                  className="border-b border-border cursor-pointer hover:bg-primary/5"
                  onClick={() => navigate(`/leaderboard/${s.version_id}`)}
                >
                  <td className="px-3 py-2 font-semibold">{s.title}</td>
                  <td className="px-3 py-2 text-center">
                    {s.top3[0] ? `🥇 ${s.top3[0].username} ${s.top3[0].percentage}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {s.top3[1] ? `🥈 ${s.top3[1].username} ${s.top3[1].percentage}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {s.top3[2] ? `🥉 ${s.top3[2].username} ${s.top3[2].percentage}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
