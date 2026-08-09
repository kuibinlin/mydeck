// Who you are signed in as.
//
// Reads straight from AuthContext — no fetch. The session cookie already
// carries id, email and username, so this paints immediately instead of
// flashing a spinner for data the app has held since boot.
import { useAuth } from "@/context/AuthContext";
import Badge from "@/components/ui/Badge";
import SettingsSection from "../SettingsSection";
import SettingsField from "../SettingsField";

export default function AccountSection() {
  const { user } = useAuth();

  // ProtectedRoute guarantees a user, but rendering nothing beats crashing if
  // that ever stops being true.
  if (!user) return null;

  return (
    <SettingsSection
      icon="fa-user"
      title="Account"
      description="The account this browser is signed in to."
      action={user.isAdmin ? <Badge>Admin</Badge> : null}
    >
      <SettingsField label="Username" icon="fa-at" value={user.username} />
      <SettingsField
        label="Email"
        icon="fa-envelope"
        value={user.email}
        empty="Not linked"
      />
    </SettingsSection>
  );
}
