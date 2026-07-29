// Settings is a list of independent sections and nothing more.
//
// Each section fetches its own data and renders its own loading and error
// state, so adding a setting means writing one file under sections/ and adding
// one line here — no change to this component's data flow, and no section can
// take the whole page down with it.
import { useNavigate } from "react-router";
import BackButton from "@/components/ui/BackButton";
import AccountSection from "./sections/AccountSection";
import AiUsageSection from "./sections/AiUsageSection";

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div>
      <BackButton onClick={() => navigate("/dashboard")} />

      <h2 className="text-xl font-bold mb-4">Settings</h2>

      <AccountSection />
      <AiUsageSection />
    </div>
  );
}
