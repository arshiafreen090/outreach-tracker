import { SettingsForm } from "@/components/SettingsForm";
import { requireAuthed } from "@/lib/auth";
import { loadSettings } from "@/lib/data";
import { updateSettings } from "../../actions";

export const metadata = { title: "Settings · Outreach Tracker" };

export default async function SettingsPage() {
  const { supabase, email } = await requireAuthed();
  const settings = await loadSettings(supabase);

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <span className="muted small">Signed in as {email}</span>
      </div>
      <SettingsForm
        key={`${settings.followUpDays}-${settings.pendingNudgeDays}-${settings.showPhotos}`}
        settings={settings}
        action={updateSettings}
      />
    </>
  );
}
