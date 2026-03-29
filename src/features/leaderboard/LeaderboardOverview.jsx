import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import { getLeaderboardSummary } from './leaderboardApi'

export default function LeaderboardOverview() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getLeaderboardSummary()
      .then(data => setSummary(data.summary ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h2 className="text-xl font-bold mb-4">
        <i className="fas fa-trophy text-warning mr-2" />
        Leaderboard
      </h2>

      {loading && <Spinner center />}
      {error && <div className="p-2.5 px-3.5 rounded-lg mb-4 text-sm bg-red-100 text-red-700 dark:bg-red-900/15 dark:text-[#ff6b6b]">{error}</div>}

      {!loading && !error && summary.length === 0 && (
        <EmptyState icon="fas fa-medal" message="No published challenges yet." />
      )}

      {!loading && !error && summary.length > 0 && (
        <div className="bg-surface rounded-card shadow-card overflow-x-auto">
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
              {summary.map(s => (
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
