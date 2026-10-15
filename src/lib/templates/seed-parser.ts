import { isCompanyCategory, type CompanyCategory } from "../categories";

export interface SeedTemplate {
  key: string;
  name: string;
  description: string | null;
  warning: string | null;
  defaultCategory: CompanyCategory | null;
  /** Exact original text. Never trimmed, normalised or rewritten. */
  body: string;
}

const HEADING = /^## (template_\d+)$/;
const META = /^- ([a-z_]+): (.*)$/;
const META_KEYS = new Set(["name", "default_category", "description", "warning"]);

interface Draft {
  key: string;
  meta: Map<string, string>;
  body: string | null;
}

/**
 * Parses templates/seed.md. Strict on purpose: anything unexpected throws
 * instead of silently producing a slightly different template.
 *
 * The body is every line between the ```text fence and the closing ``` fence,
 * joined with "\n". Nothing is trimmed, so trailing spaces survive.
 */
export function parseSeed(markdown: string): SeedTemplate[] {
  if (markdown.includes("\r")) {
    throw new Error("seed.md must use LF line endings (found a carriage return).");
  }
  if (markdown.charCodeAt(0) === 0xfeff) {
    throw new Error("seed.md must not start with a BOM.");
  }

  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let bodyLines: string[] | null = null;

  for (const [index, line] of markdown.split("\n").entries()) {
    const where = `seed.md line ${index + 1}`;

    if (bodyLines) {
      if (line === "```") {
        current!.body = bodyLines.join("\n");
        bodyLines = null;
      } else {
        bodyLines.push(line);
      }
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      current = { key: heading[1]!, meta: new Map(), body: null };
      drafts.push(current);
      continue;
    }

    // Intro prose before the first "## template_N" heading is ignored.
    if (!current) continue;

    if (line === "```text") {
      if (current.body !== null) throw new Error(`${where}: ${current.key} has two bodies.`);
      bodyLines = [];
      continue;
    }

    const meta = META.exec(line);
    if (meta) {
      const [, name, value] = meta;
      if (!META_KEYS.has(name!)) throw new Error(`${where}: unknown metadata key "${name}".`);
      if (current.meta.has(name!)) throw new Error(`${where}: duplicate "${name}" for ${current.key}.`);
      current.meta.set(name!, value!.trim());
    }
  }

  if (bodyLines) throw new Error("seed.md: unterminated ```text fence.");

  const seen = new Set<string>();
  return drafts.map((d) => {
    if (seen.has(d.key)) throw new Error(`seed.md: duplicate template key ${d.key}.`);
    seen.add(d.key);
    if (d.body === null) throw new Error(`seed.md: ${d.key} has no \`\`\`text body.`);
    const name = d.meta.get("name");
    if (!name) throw new Error(`seed.md: ${d.key} is missing "- name:".`);
    const category = d.meta.get("default_category") ?? null;
    if (category !== null && !isCompanyCategory(category)) {
      throw new Error(`seed.md: ${d.key} has unknown default_category "${category}".`);
    }
    return {
      key: d.key,
      name,
      description: d.meta.get("description") ?? null,
      warning: d.meta.get("warning") ?? null,
      defaultCategory: category,
      body: d.body,
    };
  });
}
