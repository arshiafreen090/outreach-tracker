/**
 * Seeds the four original templates (version 1) into Supabase.
 *   npm run seed:templates
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.
 * Safe to re-run: existing rows are never modified, and version 1 is read back
 * and compared byte-for-byte with templates/seed.md every time.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseSeed } from "../src/lib/templates/seed-parser";
import { seedTemplates, type TemplateStore } from "../src/lib/templates/seed";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (copy .env.example to .env.local).");
  process.exit(1);
}

const db = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const store: TemplateStore = {
  async findTemplateId(key) {
    const { data, error } = await db.from("templates").select("id").eq("key", key).maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  },
  async createTemplate(t) {
    const { data, error } = await db
      .from("templates")
      .insert({
        key: t.key,
        name: t.name,
        description: t.description,
        warning: t.warning,
        default_category: t.defaultCategory,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  },
  async addVersion(templateId, body, note) {
    const { error } = await db
      .from("template_versions")
      .insert({ template_id: templateId, body, note });
    if (error) throw error;
  },
  async getVersionBody(templateId, version) {
    const { data, error } = await db
      .from("template_versions")
      .select("body")
      .eq("template_id", templateId)
      .eq("version", version)
      .maybeSingle();
    if (error) throw error;
    return data?.body ?? null;
  },
};

const seedPath = new URL("../templates/seed.md", import.meta.url);
const templates = parseSeed(readFileSync(seedPath, "utf8"));
const report = await seedTemplates(store, templates);
for (const r of report) console.log(`${r.key}: ${r.action}, version 1 matches seed.md byte-for-byte`);
console.log(`OK: ${report.length} templates verified.`);

// Register ALLOWED_EMAIL as the one owner the database lets in (migration 0003). Exactly one row, always.
const owner = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
if (!owner) {
  console.error("ALLOWED_EMAIL is not set, so no owner was registered. Set it in .env.local and run this again.");
  process.exit(1);
}
const removed = await db.from("app_owner").delete().neq("email", owner);
const registered = await db.from("app_owner").upsert({ email: owner }, { onConflict: "email" });
const ownerError = removed.error ?? registered.error;
if (ownerError) {
  console.error(`Could not register the owner: ${ownerError.message}\nIf the table is missing, run 'npm run sql:copy:latest', paste it into the SQL Editor, press Run, then run this again.`);
  process.exit(1);
}
console.log(`OK: owner ${owner} registered. The database will accept only this email.`);
