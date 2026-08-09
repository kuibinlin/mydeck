// label: optional field label
// wrapperClassName: overrides the wrapper div class (default "mb-4")
// All other props forwarded to <input>
export default function Input({ label, wrapperClassName, ...props }) {
  return (
    <div className={wrapperClassName ?? "mb-4"}>
      {label && (
        <label className="block text-sm font-semibold mb-1.5 text-text">
          {label}
        </label>
      )}
      <input {...props} />
    </div>
  )
}
