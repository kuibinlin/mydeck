// label: optional field label
// All other props forwarded to <select>
export default function Select({ label, children, ...props }) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-sm font-semibold mb-1.5 text-text">
          {label}
        </label>
      )}
      <select {...props}>{children}</select>
    </div>
  )
}
