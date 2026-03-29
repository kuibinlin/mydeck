// clickable: adds hover lift effect
// Extend base styles via className prop.
import { cn } from '@/lib/cn'

export default function Card({ children, clickable, onClick, className = '' }) {
  return (
    <div
      className={cn(
        'bg-surface rounded-card shadow-card p-5 mb-4',
        clickable && 'cursor-pointer hover:shadow-hover hover:-translate-y-px transition-all',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
