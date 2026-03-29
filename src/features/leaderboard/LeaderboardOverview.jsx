import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import MedalBadge from '@/components/ui/MedalBadge'
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
    <div>
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
              {summary.map((s, i) => (
                <tr
                  key={s.version_id}
                  className="border-b border-border last:border-0 cursor-pointer hover:bg-primary/5 group animate-fade-in-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                  onClick={() => navigate(`/leaderboard/${s.version_id}`)}
                >
                  <td className="px-4 py-3 font-semibold">
                    <span className="inline-block border-b border-transparent group-hover:border-primary transition-colors pb-0.5">
                      {s.title}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <MedalBadge entry={s.top3[0]} position={0} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <MedalBadge entry={s.top3[1]} position={1} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <MedalBadge entry={s.top3[2]} position={2} />
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
