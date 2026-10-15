"use client";

import { AcceptedCard } from "@/components/AcceptedCard";
import { AcceptCandidateCard } from "@/components/AcceptCandidateCard";
import { EditDetails } from "@/components/EditDetails";
import { LogRequestForm } from "@/components/LogRequestForm";
import { NavLinks } from "@/components/NavLinks";
import { PendingCard } from "@/components/PendingCard";
import type { ActionResult, FormState } from "@/lib/action-types";
import type { CompanyRow, PersonRow, TemplateRow } from "@/lib/db-types";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const companies: CompanyRow[] = [
  { id: "c1", name: "Zepto", category: "quick_commerce", website: null, linkedin_url: null, notes: null,
    blurb: "Zepto is a quick-commerce company delivering groceries and essentials in about ten minutes from a network of dark stores." },
  { id: "c2", name: "Swiggy", category: "food_delivery", website: null, linkedin_url: null, notes: null, blurb: null },
  { id: "c3", name: "Kuku FM", category: "small_startup", website: null, linkedin_url: null, notes: null, blurb: null },
];

const base: PersonRow = {
  id: "p0", full_name: "", first_name: null, role: null, company_id: null, company_name_raw: null,
  profile_url: "https://www.linkedin.com/in/example/", profile_url_key: null, photo_url: null, status: "accepted",
  notes: null, requested_at: daysAgo(9), accepted_at: daysAgo(1), last_messaged_at: null, last_replied_at: null, messages_sent_count: 0,
};

const accepted: PersonRow[] = [
  { ...base, id: "p1", full_name: "Priya Sharma", role: "SDE II", company_id: "c1", company_name_raw: "Zepto" },
  { ...base, id: "p2", full_name: "Rahul Venkataraghavan-Subramaniam", role: "Co-founder & CTO", company_id: "c3", company_name_raw: "Kuku FM", accepted_at: daysAgo(3) },
  { ...base, id: "p3", full_name: "Ananya Iyer", role: null, accepted_at: daysAgo(0), messages_sent_count: 1, last_messaged_at: daysAgo(6) },
];

const pending: PersonRow[] = [
  { ...base, id: "p4", status: "requested", full_name: "Karan Mehta", role: "Data Analyst", company_id: "c2", company_name_raw: "Swiggy", requested_at: daysAgo(12), accepted_at: null },
  { ...base, id: "p5", status: "requested", full_name: "Sana Qureshi", role: "ML Engineer", company_id: "c1", company_name_raw: "Zepto", requested_at: daysAgo(2), accepted_at: null },
];

const ok = async (): Promise<ActionResult> => ({ ok: true });
const form = async (): Promise<FormState> => ({ ok: true, message: "Saved.", nonce: Date.now() });

export function PreviewClient({ templates }: { templates: TemplateRow[] }) {
  const byId = (id: string | null) => companies.find((c) => c.id === id) ?? null;
  const edit = (p: PersonRow) => <EditDetails person={p} company={byId(p.company_id)} companies={companies} action={form} />;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">Outreach Tracker · fixture preview</span>
        </div>
        <NavLinks counts={{ accepted: accepted.length, pending: pending.length, unmatched: 1 }} />
      </header>
      <main className="container stack">
        <h1>Accepted</h1>
        {accepted.map((p) => (
          <AcceptedCard
            key={p.id}
            person={p}
            company={byId(p.company_id)}
            templates={templates}
            lastMessage={p.messages_sent_count > 0 ? { person_id: p.id, template_id: templates[1]!.template_id, template_version: 1, final_text: "earlier", sent_at: daysAgo(6) } : null}
            showPhotos={false}
            onMarkSent={ok}
            editSlot={edit(p)}
          />
        ))}
        <h1>Pending</h1>
        {pending.map((p) => (
          <PendingCard key={p.id} person={p} company={byId(p.company_id)} showPhotos={false} nudgeDays={7} markAccepted={ok} editSlot={edit(p)} />
        ))}
        <h1>Unknown accepts</h1>
        <AcceptCandidateCard
          candidate={{ id: "k1", full_name: "Mrigank Bhargava", headline: "Founding team at Cardboard", company_hint: "Cardboard", profile_url: "https://www.linkedin.com/in/example/", profile_url_key: "in/example", photo_url: null, accepted_at: daysAgo(3), status: "unmatched", match_method: null, person_id: null }}
          pending={[{ id: "p4", label: "Karan Mehta (Swiggy)" }, { id: "p5", label: "Sana Qureshi (Zepto)" }]}
          companies={companies}
          showPhotos={false}
          link={form}
          create={form}
          dismiss={ok}
        />
        <h1>Log a sent request</h1>
        <LogRequestForm action={form} companies={companies} knownProfiles={{ "in/asha-rao": "Asha Rao" }} />
      </main>
    </>
  );
}
