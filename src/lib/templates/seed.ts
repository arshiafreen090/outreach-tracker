import type { SeedTemplate } from "./seed-parser";

export const SEED_VERSION_NOTE = "Original text from templates/seed.md";

/**
 * The few DB operations seeding needs. One adapter wraps supabase-js (the real
 * script), another wraps PGlite (tests), so the seeding logic itself is tested.
 */
export interface TemplateStore {
  findTemplateId(key: string): Promise<string | null>;
  createTemplate(template: SeedTemplate): Promise<string>;
  /** The DB assigns the next version number. */
  addVersion(templateId: string, body: string, note: string): Promise<void>;
  getVersionBody(templateId: string, version: number): Promise<string | null>;
}

export interface SeedReport {
  key: string;
  action: "created" | "unchanged";
}

/**
 * Idempotent. Inserts each seed template and its version 1 only when missing,
 * never touches existing rows, then reads version 1 back and requires it to be
 * byte-identical to seed.md. Throws on any mismatch.
 */
export async function seedTemplates(
  store: TemplateStore,
  templates: readonly SeedTemplate[],
): Promise<SeedReport[]> {
  const report: SeedReport[] = [];
  for (const template of templates) {
    let created = false;

    let id = await store.findTemplateId(template.key);
    if (!id) {
      id = await store.createTemplate(template);
      created = true;
    }

    let stored = await store.getVersionBody(id, 1);
    if (stored === null) {
      await store.addVersion(id, template.body, SEED_VERSION_NOTE);
      stored = await store.getVersionBody(id, 1);
      created = true;
    }

    if (stored !== template.body) {
      throw new Error(
        `${template.key}: stored version 1 is not byte-identical to templates/seed.md. Refusing to continue.`,
      );
    }
    report.push({ key: template.key, action: created ? "created" : "unchanged" });
  }
  return report;
}
