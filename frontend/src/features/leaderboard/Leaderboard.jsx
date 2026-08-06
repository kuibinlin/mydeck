import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import BackButton from '@/components/ui/BackButton'
import LeaderboardRow from './LeaderboardRow'
import { getLeaderboard } from './leaderboardApi'

export default function Leaderboard() {
  const { versionId } = useParams()
  const navigate = useNavigate()

  const [version, setVersion] = useState(null)
  const [scores, setScores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getLeaderboard(versionId)
      .then(data => {
        setVersion(data.version)
        setScores(data.scores)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [versionId])

  return (
    <div>
      <BackButton onClick={() => navigate('/dashboard')} />

      {loading && <Spinner center />}
      {error && <div className="p-2.5 px-3.5 rounded-lg mb-4 text-sm bg-red-100 text-red-700 dark:bg-red-900/15 dark:text-[#ff6b6b]">{error}</div>}

      {!loading && !error && version && (
        <>
          <h2 className="text-xl font-bold mb-1">
            {version.deck_title} — Leaderboard
          </h2>
          <p className="text-muted mb-4">
            Version {version.version} · {version.card_count} questions
          </p>

          {scores.length === 0 ? (
            <EmptyState icon="fas fa-medal" message="No scores yet. Be the first!" />
          ) : (
            scores.map((s, i) => (
              <LeaderboardRow
                key={i}
                rank={i + 1}
                username={s.username}
                score={s.score}
                total={s.total}
                percentage={s.percentage}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}
