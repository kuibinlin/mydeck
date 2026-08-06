// Simple confirm dialog overlay.
// open, title, message, onConfirm, onCancel, confirmLabel, confirmVariant
import { cn } from '@/lib/cn'

const VARIANT_CLS = {
  danger:  'bg-error hover:opacity-90 text-white',
  primary: 'bg-primary hover:bg-primary-hover text-white',
  success: 'bg-success hover:opacity-90 text-white',
}

export default function Modal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]"
      onClick={onCancel}
    >
      <div
        className="bg-surface rounded-card p-7 max-w-sm w-[90%] shadow-[0_8px_32px_rgb(0_0_0/0.2)]"
        onClick={e => e.stopPropagation()}
      >
        {title && <h3 className="text-base font-bold mb-2 text-text">{title}</h3>}
        {message && <p className="text-muted text-sm mb-5">{message}</p>}
        <div className="flex gap-2 justify-end">
          <button
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-btn bg-transparent text-muted hover:text-text transition-all cursor-pointer border-0"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className={cn(
              'inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-btn transition-all cursor-pointer border-0',
              VARIANT_CLS[confirmVariant] ?? VARIANT_CLS.danger
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
