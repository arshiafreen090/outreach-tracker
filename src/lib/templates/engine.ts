import type { CompanyCategory } from "../categories";

/**
 * Deterministic template engine. No AI, no rewriting: only these three
 * placeholders are substituted, everything else passes through untouched.
 *
 *   {{first_name}}    the person's first name
 *   {{Company}}       company name exactly as stored
 *   {{COMPANY_UPPER}} company name upper-cased
 */
export const PLACEHOLDER_NAMES = ["first_name", "Company", "COMPANY_UPPER"] as const;
export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];

export interface TemplateValues {
  firstName: string;
  company: string;
}

// Case-sensitive on purpose: "{{company}}" is NOT a placeholder and is left visible.
const KNOWN_PLACEHOLDER = /\{\{(first_name|Company|COMPANY_UPPER)\}\}/g;
const ANY_PLACEHOLDER = /\{\{[^{}]*\}\}/g;

export function placeholderValues(values: TemplateValues): Record<PlaceholderName, string> {
  return {
    first_name: values.firstName,
    Company: values.company,
    COMPANY_UPPER: values.company.toUpperCase(),
  };
}

/**
 * Fills the placeholders in a single pass. A placeholder whose value is blank
 * is left in place so a missing name/company is obvious in the textarea
 * instead of silently producing "Hey , I'm Afreen!".
 */
export function renderTemplate(body: string, values: TemplateValues): string {
  const resolved = placeholderValues(values);
  // Function replacer: a company name like "AT&T $1" must not trigger
  // String.replace's special "$&" / "$1" patterns.
  return body.replace(KNOWN_PLACEHOLDER, (token, name: PlaceholderName) =>
    resolved[name].trim() === "" ? token : resolved[name],
  );
}

/** Every `{{...}}` token still present, e.g. blank values or typos like {{company}}. */
export function findUnresolvedPlaceholders(text: string): string[] {
  return text.match(ANY_PLACEHOLDER) ?? [];
}

/** First whitespace-separated token of the full name. The card textarea stays editable for odd cases. */
export function firstNameFromFullName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** The template whose default_category matches, if any. */
export function pickDefaultTemplate<T extends { defaultCategory: CompanyCategory | null }>(
  category: CompanyCategory,
  templates: readonly T[],
): T | undefined {
  return templates.find((t) => t.defaultCategory === category);
}
