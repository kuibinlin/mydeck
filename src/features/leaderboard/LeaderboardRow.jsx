// rank: 1-based position
export default function LeaderboardRow({ rank, username, score, total, percentage }) {
  const medal =
    rank === 1 ? '🥇' :
    rank === 2 ? '🥈' :
    rank === 3 ? '🥉' :
    String(rank)

  const rankColor =
    rank === 1 ? '#FFD700' :
    rank === 2 ? '#C0C0C0' :
    rank === 3 ? '#CD7F32' :
    'var(--color-muted)'

  return (
    <div className="flex items-center px-4 py-3 bg-surface rounded-lg mb-1.5 shadow-card">
      <span className="text-lg font-bold w-9" style={{ color: rankColor }}>
        {medal}
      </span>
      <span className="flex-1 font-semibold">{username}</span>
      <span className="font-semibold text-primary">
        {score}/{total} ({percentage}%)
      </span>
    </div>
  )
}
