const MEDAL_STYLES = [
  'border border-[#FFD700]/50 bg-[#FFD700]/8',
  'border border-[#C0C0C0]/50 bg-[#C0C0C0]/8',
  'border border-[#CD7F32]/50 bg-[#CD7F32]/8',
]
const MEDAL_EMOJIS = ['🥇', '🥈', '🥉']

// entry: { username, percentage } | null
// position: 0 (gold) | 1 (silver) | 2 (bronze)
export default function MedalBadge({ entry, position }) {
  if (!entry) return <span className="text-muted">—</span>
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${MEDAL_STYLES[position]}`}>
      {MEDAL_EMOJIS[position]} {entry.username} {entry.percentage}%
    </span>
  )
}
