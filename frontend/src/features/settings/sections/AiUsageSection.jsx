// Daily AI quota.
//
// Owns its own fetch, spinner and error rather than letting the page block on
// it: a slow or failing AI endpoint should degrade this one card, not hide the
// user's account details behind a full-page spinner.
import { useState, useEffect } from "react";
import Spinner from "@/components/ui/Spinner";
import Alert from "@/components/ui/Alert";
import SettingsSection from "../SettingsSection";
import { getAISettings } from "@/lib/aiApi";

function UsageBar({ used, limit }) {
  const pct = limit ? Math.min((used / limit) * 100, 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-semibold text-text whitespace-nowrap">
        {limit ? `${used} / ${limit}` : `${used} used (unlimited)`}
      </span>
    </div>
  );
}

export default function AiUsageSection() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // `active` guards against a state update after unmount if the user
    // navigates away mid-request.
    let active = true;

    getAISettings()
      .then((data) => {
        if (active) setUsage(data.usage ?? { used: 0, limit: null });
      })
      .catch((err) => {
        if (active) setError(err.message);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <SettingsSection
      icon="fa-chart-bar"
      title="Daily AI Usage"
      description="AI generations used today (resets at midnight UTC)."
    >
      {error ? (
        <Alert>{error}</Alert>
      ) : usage ? (
        <UsageBar used={usage.used} limit={usage.limit} />
      ) : (
        <Spinner />
      )}
    </SettingsSection>
  );
}
