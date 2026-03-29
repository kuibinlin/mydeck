const RANK_STYLES = {
  1: {
    medal:  '🥇',
    border: 'border-l-4 border-[#FFD700]',
    bg:     'bg-[#FFD700]/5',
    ring:   'ring-1 ring-[#FFD700]/25',
    color:  '#FFD700',
  },
  2: {
    medal:  '🥈',
    border: 'border-l-4 border-[#C0C0C0]',
    bg:     'bg-[#C0C0C0]/5',
    ring:   '',
    color:  '#C0C0C0',
  },
  3: {
    medal:  '🥉',
    border: 'border-l-4 border-[#CD7F32]',
    bg:     'bg-[#CD7F32]/5',
    ring:   '',
    color:  '#CD7F32',
  },
}

// rank: 1-based position
export default function LeaderboardRow({ rank, username, score, total, percentage }) {
  const style = RANK_STYLES[rank]
  const medal = style?.medal ?? String(rank)
  const borderClass = style?.border ?? ''
  const bgClass = style?.bg ?? 'bg-surface'
  const ringClass = style?.ring ?? ''
  const rankColor = style?.color ?? 'var(--color-muted)'

  return (
    <div
      className={`flex items-center px-4 py-3 rounded-lg mb-1.5 shadow-card animate-fade-in-up ${borderClass} ${bgClass} ${ringClass}`}
      style={{ animationDelay: `${(rank - 1) * 60}ms` }}
    >
      <span className="text-lg font-bold w-9 shrink-0" style={{ color: rankColor }}>
        {medal}
      </span>
      <span className="flex-1 font-semibold">{username}</span>
      <span className="font-semibold text-primary">
        {score}/{total} <span className="text-muted font-normal">({percentage}%)</span>
      </span>
    </div>
  )
}
