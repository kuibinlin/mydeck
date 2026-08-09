// Lightweight classname utility — joins truthy class strings.
// Usage: cn('base', condition && 'extra', className)
export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}
