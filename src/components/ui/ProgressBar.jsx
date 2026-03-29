// pct: 0–100
// label: optional text above bar
export default function ProgressBar({ pct, label }) {
  return (
    <>
      {label && (
        <div className="text-center text-muted text-sm mb-3">{label}</div>
      )}
      <div className="w-full h-1 bg-border rounded-full mb-5">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </>
  )
}
