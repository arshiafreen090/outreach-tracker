import { TemplateEditor, type VersionInfo } from "@/components/TemplateEditor";
import { requireAuthed } from "@/lib/auth";
import { loadTemplates } from "@/lib/data";
import { saveTemplateVersion } from "../../actions";

export const metadata = { title: "Templates · Outreach Tracker" };

export default async function TemplatesPage() {
  const { supabase } = await requireAuthed();
  const templates = await loadTemplates(supabase);
  const { data, error } = await supabase
    .from("template_versions")
    .select("template_id, version, note, created_at, body")
    .order("version", { ascending: false });
  if (error) throw new Error(`Could not load template versions: ${error.message}`);

  const versionsByTemplate = new Map<string, VersionInfo[]>();
  for (const row of data ?? []) {
    const list = versionsByTemplate.get(row.template_id) ?? [];
    list.push({ version: row.version, note: row.note, created_at: row.created_at, body: row.body });
    versionsByTemplate.set(row.template_id, list);
  }

  return (
    <>
      <div className="page-head">
        <h1>Templates</h1>
      </div>
      <p className="muted">
        Saving creates a new version; old versions are kept, and every sent message records the version it used. The originals are in <code>templates/seed.md</code>.
      </p>
      {templates.length === 0 ? (
        <p className="empty">No templates yet. Run <code>npm run seed:templates</code>.</p>
      ) : (
        templates.map((t) => (
          <TemplateEditor
            key={`${t.template_id}-${t.version}`}
            template={t}
            versions={versionsByTemplate.get(t.template_id) ?? []}
            action={saveTemplateVersion}
          />
        ))
      )}
    </>
  );
}
