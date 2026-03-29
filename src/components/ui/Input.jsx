// label: optional field label
// All other props forwarded to <input>
export default function Input({ label, ...props }) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-sm font-semibold mb-1.5 text-text">
          {label}
        </label>
      )}
      <input {...props} />
    </div>
  )
}
