import { Avatar } from "@/components/Avatar";
import { CATEGORY_LABELS } from "@/lib/categories";
import { requireAuthed } from "@/lib/auth";
import { companyById, loadCompanies, loadLastMessages, loadMessagedPeople, loadSettings, loadTemplates } from "@/lib/data";
import { STATUS_LABELS } from "@/lib/status";
import { formatDateTime } from "@/lib/time";

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

  return (
    <>
      <div className="page-head">
        <h1>Messaged</h1>
        <span className="muted small">{people.length} people</span>
      </div>

      {people.length === 0 ? (
        <p className="empty">Nothing sent yet. Messages you mark as sent are logged here with the template and version used.</p>
      ) : (
        people.map((person) => {
          const company = person.company_id ? (companiesById.get(person.company_id) ?? null) : null;
          const last = lastMessages.get(person.id);
          const template = last ? templatesById.get(last.template_id) : undefined;
          const companyName = company?.name ?? person.company_name_raw ?? "";
          return (
            <article key={person.id} className="card" aria-label={person.full_name}>
              <div className="person">
                <Avatar name={person.full_name} photoUrl={person.photo_url} showPhotos={settings.showPhotos} />
                <div className="person-main">
                  <h2 className="person-name">{person.full_name}</h2>
                  <div className="person-sub">{[person.role, companyName].filter(Boolean).join(" · ") || "No role or company"}</div>
                  <div className="chips">
                    <span className="chip accent">{STATUS_LABELS[person.status]}</span>
                    {company && <span className="chip">{CATEGORY_LABELS[company.category]}</span>}
                    {last && (
                      <span className="chip">
                        {formatDateTime(last.sent_at)} · {template?.name ?? "Template"} v{last.template_version}
                      </span>
                    )}
                    {person.messages_sent_count > 1 && <span className="chip warn">{person.messages_sent_count} messages</span>}
                  </div>
                </div>
              </div>
              {last && (
                <details className="more">
                  <summary>View the message as sent</summary>
                  <pre className="sent">{last.final_text}</pre>
                </details>
              )}
            </article>
          );
        })
      )}
    </>
  );
}
