import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '@/context/AuthContext'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import SearchInput from '@/components/ui/SearchInput'
import BackButton from '@/components/ui/BackButton'
import { getDecks, getDeck } from './challengeApi'

export default function ChallengeList() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [decks, setDecks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showMine, setShowMine] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')

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

  const categories = [...new Set(decks.map(d => d.category).filter(Boolean))].sort()

  const visible = decks.filter(d => {
    if (showMine && d.created_by !== user?.id) return false
    if (category && d.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      if (!d.title?.toLowerCase().includes(q) && !d.description?.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div>
      <BackButton onClick={() => navigate('/dashboard')} />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h2 className="text-xl font-bold">Challenge Decks</h2>
        <button
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-btn transition-all cursor-pointer border ${showMine ? 'bg-success text-white border-success hover:opacity-90' : 'bg-transparent text-primary border-primary hover:bg-primary hover:text-white'}`}
          onClick={() => setShowMine(m => !m)}
        >
          <i className={`fas ${showMine ? 'fa-globe' : 'fa-user'}`} />
          {showMine ? 'All Decks' : 'My Decks'}
        </button>
        <div className="flex-1" />
        <button
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-primary hover:bg-primary-hover text-white font-semibold rounded-btn transition-all cursor-pointer border border-transparent"
          onClick={() => navigate('/challenges/new')}
        >
          <i className="fas fa-plus" /> Create Challenge
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <SearchInput
          placeholder="Search challenges…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-btn border border-[var(--color-border)] bg-surface text-text focus:outline-none focus:border-primary cursor-pointer"
        >
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading && <Spinner center />}
      {error && <div className="p-2.5 px-3.5 rounded-lg mb-4 text-sm bg-red-100 text-red-700 dark:bg-red-900/15 dark:text-[#ff6b6b]">{error}</div>}

      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon="fas fa-trophy"
          message={
            search || category
              ? 'No challenges match your search.'
              : showMine
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
              className="bg-surface rounded-card shadow-card p-5 cursor-pointer border-l-4 border-warning hover:shadow-hover hover:-translate-y-px transition-all flex flex-col"
              onClick={() => navigate(`/challenges/${d.id}`)}
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold mb-1 line-clamp-2">{d.title}</h3>
                  {d.description && (
                    <p className="text-muted text-sm line-clamp-2">{d.description}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {d.current_version
                    ? <Badge>v{d.current_version} · {d.card_count}Q</Badge>
                    : <Badge outline>Draft</Badge>
                  }
                </div>
              </div>

              <div className="mt-auto pt-3 flex items-center gap-3 text-xs text-muted">
                <span className="flex-1 flex gap-3 min-w-0">
                  <span className="shrink-0"><i className="fas fa-folder" style={{ marginRight: 3 }} />{d.category}</span>
                  <span className="shrink-0"><i className="fas fa-user" style={{ marginRight: 3 }} />{d.author || 'Unknown'}</span>
                </span>
                <div className="flex gap-2 shrink-0">
                  {d.current_version && (
                    <button
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-xs bg-transparent text-primary border border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer"
                      onClick={e => handleLeaderboard(e, d.id)}
                    >
                      <i className="fas fa-medal" /> Leaderboard
                    </button>
                  )}
                  {(d.created_by === user?.id || user?.isAdmin) && (
                    <button
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-xs bg-transparent text-primary border border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer"
                      onClick={e => { e.stopPropagation(); navigate(`/challenges/${d.id}/edit`) }}
                    >
                      <i className="fas fa-edit" /> Edit
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
