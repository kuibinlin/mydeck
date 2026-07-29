// The frame every settings block shares: icon, heading, optional description,
// optional action in the top-right corner.
//
// Sections supply only their own body. Keeping the chrome here is what stops
// the page drifting into five slightly different card headers as it grows.
import Card from "@/components/ui/Card";

export default function SettingsSection({
  icon,
  title,
  description,
  action,
  children,
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-semibold">
            <i
              className={`fas ${icon} mr-1.5`}
              style={{ color: "var(--color-primary)" }}
            />
            {title}
          </h3>
          {description && (
            <p className="text-sm text-muted mt-1">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </Card>
  );
}
