import { AcceptCandidateCard } from "@/components/AcceptCandidateCard";
import { requireAuthed } from "@/lib/auth";
import { loadCompanies, loadPeopleByStatus, loadSettings, loadUnmatchedAccepts } from "@/lib/data";
import { createPersonFromAccept, dismissAccept, linkAccept } from "../../actions";

export const metadata = { title: "Unknown accepts · Outreach Tracker" };

export default async function UnmatchedPage() {
  const { supabase } = await requireAuthed();
  const [candidates, companies, requested, settings] = await Promise.all([
    loadUnmatchedAccepts(supabase),
    loadCompanies(supabase),
    loadPeopleByStatus(supabase, ["requested"]),
    loadSettings(supabase),
  ]);
  const byCompany = new Map(companies.map((c) => [c.id, c.name]));
  const pending = requested
    .sort((a, b) => (a.requested_at ?? "").localeCompare(b.requested_at ?? ""))
    .map((p) => {
      const company = p.company_id ? byCompany.get(p.company_id) : p.company_name_raw;
      return { id: p.id, label: company ? `${p.full_name} (${company})` : p.full_name };
    });

  return (
    <>
      <div className="page-head">
        <h1>Unknown accepts</h1>
        <span className="muted small">{candidates.length} to sort out</span>
      </div>
      <p className="muted">
        LinkedIn emailed that these people accepted a request, but none of the requests you logged matches by profile URL or by an unambiguous name.
      </p>

      {candidates.length === 0 ? (
        <p className="empty">Nothing to sort out. Accepts that match a request you logged go straight to Accepted.</p>
      ) : (
        candidates.map((c) => (
          <AcceptCandidateCard
            key={c.id}
            candidate={c}
            pending={pending}
            companies={companies}
            showPhotos={settings.showPhotos}
            link={linkAccept.bind(null, c.id)}
            create={createPersonFromAccept.bind(null, c.id)}
            dismiss={dismissAccept.bind(null, c.id)}
          />
        ))
      )}
    </>
  );
}
