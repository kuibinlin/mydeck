// label: optional field label
// All other props forwarded to <textarea>
export default function Textarea({ label, ...props }) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-sm font-semibold mb-1.5 text-text">
          {label}
        </label>
      )}
      <textarea {...props} />
    </div>
  )
}
