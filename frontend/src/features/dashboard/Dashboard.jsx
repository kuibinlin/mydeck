import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '@/context/AuthContext'
import Spinner from '@/components/ui/Spinner'
import MedalBadge from '@/components/ui/MedalBadge'
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
    <div>
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
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b-2 border-border text-left text-muted text-sm uppercase tracking-wider">
                <th className="px-4 py-3 font-semibold">Challenge</th>
                <th className="px-4 py-3 text-center font-semibold">1st</th>
                <th className="px-4 py-3 text-center font-semibold">2nd</th>
                <th className="px-4 py-3 text-center font-semibold">3rd</th>
              </tr>
            </thead>
            <tbody>
              {summary?.map(s => (
                <tr
                  key={s.version_id}
                  className="border-b border-border last:border-0 cursor-pointer hover:bg-primary/5 group"
                  onClick={() => navigate(`/leaderboard/${s.version_id}`)}
                >
                  <td className="px-4 py-3 font-semibold">
                    <span className="inline-block border-b border-transparent group-hover:border-primary transition-colors pb-0.5">
                      {s.title}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center"><MedalBadge entry={s.top3[0]} position={0} /></td>
                  <td className="px-4 py-3 text-center"><MedalBadge entry={s.top3[1]} position={1} /></td>
                  <td className="px-4 py-3 text-center"><MedalBadge entry={s.top3[2]} position={2} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
