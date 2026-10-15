import { AcceptedCard } from "@/components/AcceptedCard";
import { EditDetails } from "@/components/EditDetails";
import { requireAuthed } from "@/lib/auth";
import { companyById, loadCompanies, loadLastMessages, loadPeopleByStatus, loadSettings, loadTemplates } from "@/lib/data";
import { markMessageSent, updatePersonDetails } from "../actions";

export const metadata = { title: "Accepted · Outreach Tracker" };

export default async function AcceptedPage() {
  const { supabase } = await requireAuthed();
  const [people, companies, allTemplates, settings] = await Promise.all([
    loadPeopleByStatus(supabase, ["accepted"]),
    loadCompanies(supabase),
    loadTemplates(supabase),
    loadSettings(supabase),
  ]);
  const lastMessages = await loadLastMessages(
    supabase,
    people.filter((p) => p.messages_sent_count > 0).map((p) => p.id),
  );
  const companiesById = companyById(companies);
  const templates = allTemplates.filter((t) => !t.is_archived);
  // Freshest accepts first: they are the most time-sensitive.
  people.sort((a, b) => (b.accepted_at ?? "").localeCompare(a.accepted_at ?? ""));

  return (
    <>
      <div className="page-head">
        <h1>Accepted</h1>
        <span className="muted small">{people.length} to message</span>
      </div>

      {people.length === 0 ? (
        <p className="empty">
          Nobody is waiting for a message. When a request is accepted, mark it accepted under Pending and it shows up here with the message ready.
        </p>
      ) : (
        people.map((person) => {
          const company = person.company_id ? (companiesById.get(person.company_id) ?? null) : null;
          return (
            <AcceptedCard
              key={person.id}
              person={person}
              company={company}
              templates={templates}
              lastMessage={lastMessages.get(person.id) ?? null}
              showPhotos={settings.showPhotos}
              onMarkSent={markMessageSent}
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
