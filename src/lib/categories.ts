/**
 * Company categories. The category drives the default outreach template.
 * The category -> template mapping is NOT hardcoded here: it lives in
 * `templates.default_category` (seeded from templates/seed.md), so there is a
 * single source of truth. See `pickDefaultTemplate` in templates/engine.ts.
 */
export const COMPANY_CATEGORIES = [
  "quick_commerce",
  "food_delivery",
  "other_relevant",
  "small_startup",
] as const;

export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CompanyCategory, string> = {
  quick_commerce: "Quick commerce",
  food_delivery: "Food delivery",
  other_relevant: "Other relevant (AI / ML / data)",
  small_startup: "Small startup (not as intern)",
};

export function isCompanyCategory(value: unknown): value is CompanyCategory {
  return (
    typeof value === "string" &&
    (COMPANY_CATEGORIES as readonly string[]).includes(value)
  );
}
