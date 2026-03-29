import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '@/context/AuthContext'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import { getDecks, getDeck } from './challengeApi'

export default function ChallengeList() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [decks, setDecks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showMine, setShowMine] = useState(false)

  useEffect(() => {
    getDecks()
      .then(d => setDecks(d.decks))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleLeaderboard = async (e, deckId) => {
    e.stopPropagation()
    try {
      const data = await getDeck(deckId)
      if (data.version) navigate(`/leaderboard/${data.version.id}`)
    } catch (err) {
      alert(err.message)
    }
  }

  const visible = showMine ? decks.filter(d => d.created_by === user?.id) : decks

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          className="inline-flex items-center gap-1.5 text-primary text-sm font-semibold mb-4 cursor-pointer bg-transparent border-0 p-0 hover:opacity-80 transition-all"
          onClick={() => navigate('/dashboard')}
        >
          <i className="fas fa-arrow-left" /> Back
        </button>
        <button
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-primary hover:bg-primary-hover text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
          onClick={() => navigate('/challenges/new')}
        >
          <i className="fas fa-plus" /> Create Challenge
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <h2 className="flex-1 text-xl font-bold">Challenge Decks</h2>
        <button
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-btn transition-all cursor-pointer border-0 ${showMine ? 'bg-success hover:opacity-90 text-white' : 'bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white'}`}
          onClick={() => setShowMine(m => !m)}
        >
          <i className={`fas ${showMine ? 'fa-globe' : 'fa-user'}`} />
          {showMine ? 'All Decks' : 'My Decks'}
        </button>
      </div>

      {loading && <Spinner center />}
      {error && <div className="p-2.5 px-3.5 rounded-lg mb-4 text-sm bg-red-100 text-red-700 dark:bg-red-900/15 dark:text-[#ff6b6b]">{error}</div>}

      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon="fas fa-trophy"
          message={
            showMine
              ? "You haven't created any challenges yet.\nCreate one to get started!"
              : 'No challenges yet.\nCreate one to get started!'
          }
        />
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          {visible.map(d => (
            <div
              key={d.id}
              className="bg-surface rounded-card shadow-card p-5 mb-0 cursor-pointer border-l-4 border-warning hover:shadow-hover hover:-translate-y-px transition-all"
              onClick={() => navigate(`/challenges/${d.id}`)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold mb-1">{d.title}</h3>
                  {d.description && (
                    <p className="text-muted text-sm">{d.description}</p>
                  )}
                </div>
                <div className="text-right">
                  {d.current_version
                    ? <Badge>v{d.current_version} · {d.card_count}Q</Badge>
                    : <Badge outline>Draft</Badge>
                  }
                </div>
              </div>
              <div className="text-xs text-muted flex gap-3 mt-1.5">
                <span><i className="fas fa-folder" style={{ marginRight: 3 }} />{d.category}</span>
                <span><i className="fas fa-user" style={{ marginRight: 3 }} />{d.author || 'Unknown'}</span>
              </div>
              <div className="mt-2 flex gap-2">
                {d.current_version && (
                  <button
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
                    onClick={e => handleLeaderboard(e, d.id)}
                  >
                    <i className="fas fa-medal" /> Leaderboard
                  </button>
                )}
                {d.created_by === user?.id && (
                  <button
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer border-0"
                    onClick={e => { e.stopPropagation(); navigate(`/challenges/${d.id}/edit`) }}
                  >
                    <i className="fas fa-edit" /> Edit
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
