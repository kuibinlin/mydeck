// label: optional field label
// wrapperClassName: overrides the wrapper div class (default "mb-4")
// All other props forwarded to <textarea>
export default function Textarea({ label, wrapperClassName, ...props }) {
  return (
    <div className={wrapperClassName ?? "mb-4"}>
      {label && (
        <label className="block text-sm font-semibold mb-1.5 text-text">
          {label}
        </label>
      )}
      <textarea {...props} />
    </div>
  )
}
