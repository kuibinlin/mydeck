// icon: font-awesome class e.g. "fas fa-layer-group"
// action: optional { label, onClick }
export default function EmptyState({ icon, message, action }) {
  return (
    <div className="text-center py-16 px-5 text-muted">
      {icon && <i className={`${icon} text-5xl mb-3 block`} />}
      <p className="whitespace-pre-line">{message}</p>
      {action && (
        <button
          className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white text-sm font-semibold rounded-btn transition-all cursor-pointer border-0 mt-4"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
