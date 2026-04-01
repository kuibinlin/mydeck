import Button from "@/components/ui/Button";

// Shared preview modal shell used by CsvImport and AI generation previews.
//
// Props:
//   title         — header text, e.g. "Import Preview — 5 of 8 cards"
//   hint          — optional info bar text below the header
//   onClose       — called when X button or backdrop is clicked
//   confirmLabel  — confirm button label
//   confirming    — true while the async confirm action is running
//   confirmingLabel — label shown while confirming (defaults to "Processing…")
//   onConfirm     — called when confirm button is clicked
//   children      — the scrollable body content
export default function PreviewModal({
  title,
  hint,
  onClose,
  confirmLabel,
  confirming = false,
  confirmingLabel = "Processing…",
  onConfirm,
  children,
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4"
      onClick={() => !confirming && onClose()}
    >
      <div
        className="bg-surface rounded-card shadow-[0_8px_32px_rgb(0_0_0/0.2)] w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <h3 className="font-bold text-base">{title}</h3>
          <button
            className="inline-flex items-center justify-center w-7 h-7 text-muted hover:text-text bg-transparent border-0 cursor-pointer rounded-btn transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onClose}
            disabled={confirming}
          >
            <i className="fas fa-times" />
          </button>
        </div>

        {/* Hint bar */}
        {hint && (
          <div className="px-5 py-2.5 bg-primary/5 border-b border-border shrink-0 flex items-center gap-2 text-xs text-muted">
            <i className="fas fa-info-circle text-primary shrink-0" />
            {hint}
          </div>
        )}

        {/* Scrollable body */}
        <div className="overflow-auto flex-1">{children}</div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-border shrink-0">
          <Button variant="success" onClick={onConfirm} disabled={confirming}>
            {confirming ? (
              <>
                <i className="fas fa-spinner fa-spin" /> {confirmingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={confirming}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
