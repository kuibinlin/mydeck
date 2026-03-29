import { useNavigate } from 'react-router'

// Clickable summary card shown on the dashboard
// icon: font-awesome class, accentColor: CSS color value
export default function HeroCard({ icon, title, count, accentColor, to }) {
  const navigate = useNavigate()

  return (
    <div
      className="flex-1 bg-surface rounded-card shadow-card cursor-pointer hover:shadow-hover hover:-translate-y-px transition-all px-6 py-8 text-center"
      style={{ borderLeft: `4px solid ${accentColor}` }}
      onClick={() => navigate(to)}
    >
      <i
        className={icon}
        style={{ fontSize: '2rem', color: accentColor, marginBottom: 12, display: 'block' }}
      />
      <h3 className="text-lg font-semibold">{title}</h3>
      {count !== undefined && (
        <p className="text-muted text-sm mt-1">{count}</p>
      )}
    </div>
  )
}
