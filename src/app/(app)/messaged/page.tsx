import { ConversationCard } from "@/components/ConversationCard";
import { requireAuthed } from "@/lib/auth";
import { companyById, loadCompanies, loadLastMessages, loadMessagedPeople, loadSettings, loadTemplates } from "@/lib/data";
import { GROUP_ORDER, GROUP_TITLES, groupConversations } from "@/lib/followups";
import { markFollowedUp, markReplied, setPersonStatus } from "../../actions";

export const metadata = { title: "Messaged · Outreach Tracker" };

export default async function MessagedPage() {
  const { supabase } = await requireAuthed();
  const [people, companies, templates, settings] = await Promise.all([
    loadMessagedPeople(supabase),
    loadCompanies(supabase),
    loadTemplates(supabase),
    loadSettings(supabase),
  ]);
  const lastMessages = await loadLastMessages(supabase, people.map((p) => p.id));
  const companiesById = companyById(companies);
  const templatesById = new Map(templates.map((t) => [t.template_id, t]));
  const groups = groupConversations(people, settings.followUpDays);

  return (
    <>
      <div className="page-head">
        <h1>Messaged</h1>
        <span className="muted small">
          {people.length} people · follow-up after {settings.followUpDays} days of silence
        </span>
      </div>

      {people.length === 0 ? (
        <p className="empty">Nothing sent yet. Messages you mark as sent are logged here with the template and version used.</p>
      ) : (
        GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
          <section key={g} className="stack" aria-labelledby={`group-${g}`}>
            <h2 id={`group-${g}`} className={g === "due" ? "" : "muted"}>
              {GROUP_TITLES[g]} ({groups[g].length})
            </h2>
            {groups[g].map((person) => {
              const company = person.company_id ? (companiesById.get(person.company_id) ?? null) : null;
              const last = lastMessages.get(person.id) ?? null;
              return (
                <ConversationCard
                  key={person.id}
                  person={person}
                  company={company}
                  lastMessage={last}
                  templateName={last ? (templatesById.get(last.template_id)?.name ?? null) : null}
                  followUpDays={settings.followUpDays}
                  showPhotos={settings.showPhotos}
                  markReplied={markReplied.bind(null, person.id)}
                  markFollowedUp={markFollowedUp.bind(null, person.id)}
                  setStatus={setPersonStatus.bind(null, person.id)}
                />
              );
            })}
          </section>
        ))
      )}
    </>
  );
}
