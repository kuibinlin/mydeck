// outline: transparent badge with border
import { cn } from '@/lib/cn'

export default function Badge({ children, outline }) {
  return (
    <span className={cn(
      'inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold',
      outline
        ? 'bg-transparent border border-border text-muted'
        : 'bg-primary text-white'
    )}>
      {children}
    </span>
  )
}
