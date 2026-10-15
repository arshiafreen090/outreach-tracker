import { LogRequestForm } from "@/components/LogRequestForm";
import { requireAuthed } from "@/lib/auth";
import { loadCompanies, loadKnownProfiles } from "@/lib/data";
import { logRequest } from "../../actions";

export const metadata = { title: "Log request · Outreach Tracker" };

export default async function LogPage() {
  const { supabase } = await requireAuthed();
  const [companies, knownProfiles] = await Promise.all([loadCompanies(supabase), loadKnownProfiles(supabase)]);

  return (
    <>
      <div className="page-head">
        <h1>Log a sent request</h1>
      </div>
      <p className="muted">
        After you send a connection request on LinkedIn, paste the profile URL and name here. The URL is how an accept email is matched to this person later.
      </p>
      <LogRequestForm action={logRequest} companies={companies} knownProfiles={knownProfiles} />
    </>
  );
}
