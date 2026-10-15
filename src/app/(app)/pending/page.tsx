import { EditDetails } from "@/components/EditDetails";
import { PendingCard } from "@/components/PendingCard";
import { requireAuthed } from "@/lib/auth";
import { companyById, loadCompanies, loadPeopleByStatus, loadSettings } from "@/lib/data";
import { markAccepted, updatePersonDetails } from "../../actions";

export const metadata = { title: "Pending · Outreach Tracker" };

export default async function PendingPage() {
  const { supabase } = await requireAuthed();
  const [people, companies, settings] = await Promise.all([
    loadPeopleByStatus(supabase, ["requested"]),
    loadCompanies(supabase),
    loadSettings(supabase),
  ]);
  const companiesById = companyById(companies);
  // Oldest first, so the requests that need a nudge come first.
  people.sort((a, b) => (a.requested_at ?? "").localeCompare(b.requested_at ?? ""));

  return (
    <>
      <div className="page-head">
        <h1>Pending</h1>
        <span className="muted small">
          {people.length} waiting · nudge after {settings.pendingNudgeDays} days
        </span>
      </div>

      {people.length === 0 ? (
        <p className="empty">No pending requests. Log one after you send it from LinkedIn.</p>
      ) : (
        people.map((person) => {
          const company = person.company_id ? (companiesById.get(person.company_id) ?? null) : null;
          return (
            <PendingCard
              key={person.id}
              person={person}
              company={company}
              showPhotos={settings.showPhotos}
              nudgeDays={settings.pendingNudgeDays}
              markAccepted={markAccepted.bind(null, person.id)}
              editSlot={
                <EditDetails person={person} company={company} companies={companies} action={updatePersonDetails.bind(null, person.id)} />
              }
            />
          );
        })
      )}
    </>
  );
}
