import { useNavigate } from 'react-router'

export default function ResultsCard({ score, total, versionId, deckId }) {
  const navigate = useNavigate()
  const pct = Math.round((score / total) * 100)
  const feedback = pct >= 80 ? 'Great job!' : pct >= 50 ? 'Good effort!' : 'Keep studying!'

  return (
    <div className="bg-surface rounded-card shadow-card p-8 text-center">
      <div className="text-5xl font-bold text-primary">
        {pct}%
      </div>
      <p className="text-lg my-2">
        {score} / {total} correct
      </p>
      <p className="text-muted mb-5">{feedback}</p>
      <div className="flex gap-2 justify-center flex-wrap">
        <button
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm bg-primary hover:bg-primary-hover text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
          onClick={() => navigate(`/challenges/${deckId}`)}
        >
          <i className="fas fa-redo" /> Try Again
        </button>
        {versionId && (
          <button
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
            onClick={() => navigate(`/leaderboard/${versionId}`)}
          >
            <i className="fas fa-medal" /> Leaderboard
          </button>
        )}
      </div>
    </div>
  )
}
