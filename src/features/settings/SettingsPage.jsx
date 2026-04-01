import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import Spinner from "@/components/ui/Spinner";
import BackButton from "@/components/ui/BackButton";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import { getAISettings } from "@/lib/aiApi";

export default function SettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState({ used: 0, limit: null });
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    getAISettings()
      .then((data) => {
        if (data.usage) setUsage(data.usage);
      })
      .catch((err) => setMsg({ type: "error", text: err.message }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner center />;

  const usagePct = usage.limit
    ? Math.min((usage.used / usage.limit) * 100, 100)
    : 0;

  return (
    <div>
      <BackButton onClick={() => navigate("/dashboard")} />

      <h2 className="text-xl font-bold mb-4">Settings</h2>

      {msg && <Alert variant={msg.type}>{msg.text}</Alert>}

      <Card>
        <h3 className="text-lg font-semibold mb-3">
          <i
            className="fas fa-chart-bar mr-1.5"
            style={{ color: "var(--color-primary)" }}
          />
          Daily AI Usage
        </h3>
        <p className="text-sm text-muted mb-3">
          AI generations used today (resets at midnight UTC).
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2.5 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-text whitespace-nowrap">
            {usage.limit
              ? `${usage.used} / ${usage.limit}`
              : `${usage.used} used (unlimited)`}
          </span>
        </div>
      </Card>
    </div>
  );
}
