export default function BackButton({ onClick }) {
  return (
    <button
      className="inline-flex items-center gap-1.5 text-primary text-sm font-semibold mb-4 cursor-pointer bg-transparent border-0 p-0 hover:opacity-80 transition-all"
      onClick={onClick}
    >
      <i className="fas fa-arrow-left" /> Back
    </button>
  )
}
