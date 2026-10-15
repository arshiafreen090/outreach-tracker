import type { CompanyCategory } from "../categories";
import type { TemplateRow } from "../db-types";
import { pickDefaultTemplate } from "./engine";

/**
 * The template a company's category selects by default. With no company yet,
 * "other_relevant" (Template 1 in the seed) is the neutral choice. Falls back to
 * the first template so the card is always usable.
 */
export function defaultTemplateFor(
  category: CompanyCategory | null,
  templates: readonly TemplateRow[],
): TemplateRow | undefined {
  const wanted = category ?? "other_relevant";
  const hit = pickDefaultTemplate(
    wanted,
    templates.map((row) => ({ row, defaultCategory: row.default_category })),
  );
  return hit?.row ?? templates[0];
}
