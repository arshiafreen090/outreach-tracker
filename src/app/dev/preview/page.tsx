import { readFileSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import type { TemplateRow } from "@/lib/db-types";
import { parseSeed } from "@/lib/templates/seed-parser";
import { PreviewClient } from "./PreviewClient";

// Fixture-only UI preview for local development. The proxy lets /dev/* through only outside
// production, and this page also refuses to render there. It never touches Supabase.
export const dynamic = "force-dynamic";
export const metadata = { title: "UI preview (dev only)" };

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const seed = readFileSync(path.join(process.cwd(), "templates", "seed.md"), "utf8");
  const templates: TemplateRow[] = parseSeed(seed).map((t, i) => ({
    template_id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    key: t.key,
    name: t.name,
    description: t.description,
    warning: t.warning,
    default_category: t.defaultCategory,
    is_archived: false,
    version: 1,
    body: t.body,
  }));

  return <PreviewClient templates={templates} />;
}
