// value, onChange, placeholder forwarded to <input>
export default function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative flex-1 min-w-40">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="w-full pl-3 pr-8 py-1.5 text-sm rounded-btn border border-[var(--color-border)] bg-surface text-text placeholder:text-muted focus:outline-none focus:border-primary"
      />
      <i className="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-muted text-xs pointer-events-none" />
    </div>
  )
}
