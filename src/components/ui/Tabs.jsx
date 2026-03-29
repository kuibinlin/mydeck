// tabs: [{ label, value }]
// active: current value
// onChange: (value) => void
import { cn } from '@/lib/cn'

export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 bg-surface rounded-card p-1 mb-5 shadow-card">
      {tabs.map(t => (
        <button
          key={t.value}
          className={cn(
            'flex-1 py-2.5 px-2 rounded-lg text-sm font-semibold transition-all cursor-pointer border-0',
            active === t.value
              ? 'bg-primary text-white'
              : 'bg-transparent text-muted hover:text-text'
          )}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
