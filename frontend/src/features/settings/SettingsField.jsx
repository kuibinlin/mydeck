// One label → value row inside a settings section.
//
// `value` takes a node as happily as a string, so a field can render a Badge or
// a button without a second component. The last row drops its divider so a
// section never ends on a stray line.
export default function SettingsField({ label, value, icon, empty = "—" }) {
  const isEmpty = value === null || value === undefined || value === "";

  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border last:border-0 last:pb-0">
      <span className="text-sm text-muted shrink-0">
        {icon && <i className={`fas ${icon} mr-2 w-4 text-center`} />}
        {label}
      </span>
      <span className="text-sm font-medium text-text text-right break-all">
        {isEmpty ? <span className="text-muted font-normal">{empty}</span> : value}
      </span>
    </div>
  );
}
