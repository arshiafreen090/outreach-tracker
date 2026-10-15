import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPANY_CATEGORIES } from "@/lib/categories";
import {
  findUnresolvedPlaceholders,
  firstNameFromFullName,
  pickDefaultTemplate,
  renderTemplate,
  type TemplateValues,
} from "@/lib/templates/engine";
import { parseSeed, type SeedTemplate } from "@/lib/templates/seed-parser";

const SEED_PATH = fileURLToPath(new URL("../templates/seed.md", import.meta.url));
const seedText = readFileSync(SEED_PATH, "utf8");
const templates = parseSeed(seedText);
const byKey = (key: string): SeedTemplate => {
  const t = templates.find((x) => x.key === key);
  if (!t) throw new Error(`no ${key} in seed.md`);
  return t;
};

/**
 * Pinned fingerprints of the originals. If templates/seed.md is touched (an
 * editor trimming trailing spaces, git rewriting line endings, a "typo fix"),
 * this fails. Update these ONLY when you deliberately change the originals.
 */
const PINNED: Record<string, { sha256: string; bytes: number }> = {
  template_1: { sha256: "4edc8770bc3708e0d8cdf1b6fbb5710e5fd25bf15367f45207d6cf9fa9f7185f", bytes: 1198 },
  template_2: { sha256: "b749a37018d204bf77ece9a9b07862f29d321d5ee0f18e64d3fa2960a239c5ce", bytes: 1123 },
  template_3: { sha256: "0ff7cb9568616ecbc254016ecf9d7bb1d6b981819a8d7d16b774be6be9b0c8ab", bytes: 1008 },
  template_4: { sha256: "de74f7f973a3bd07ac01fda5f7e58383684018ce7a0130d665f3d34df69844a3", bytes: 954 },
};

const SAMPLES: { label: string; values: TemplateValues }[] = [
  { label: "plain", values: { firstName: "Priya", company: "Zepto" } },
  { label: "multi-word company", values: { firstName: "Ravi", company: "Swiggy Instamart" } },
  // "$&", "$1" and "{{first_name}}" in a value must come out verbatim, not be re-interpreted.
  { label: "regex/placeholder-hostile company", values: { firstName: "Asha", company: "AT&T $& $1 {{first_name}}" } },
  { label: "non-ASCII", values: { firstName: "Zoë", company: "Zéptö" } },
];

function expectedValue(name: string, v: TemplateValues): string {
  if (name === "first_name") return v.firstName;
  if (name === "Company") return v.company;
  if (name === "COMPANY_UPPER") return v.company.toUpperCase();
  throw new Error(`unexpected placeholder ${name}`);
}

/**
 * Independent oracle: walks the original and the output side by side.
 * Every literal stretch of the original must appear byte-for-byte in the
 * output, and the only differences allowed are at placeholder positions,
 * where the output must hold exactly the expected value.
 */
function assertOnlyPlaceholdersDiffer(original: string, output: string, v: TemplateValues) {
  const bytes = (s: string) => Buffer.from(s, "utf8");
  const re = /\{\{(first_name|Company|COMPANY_UPPER)\}\}/g;
  let originalPos = 0;
  let outputPos = 0;

  const expectLiteral = (literal: string) => {
    const actual = output.slice(outputPos, outputPos + literal.length);
    expect(bytes(actual).equals(bytes(literal)), `literal mismatch at output offset ${outputPos}`).toBe(true);
    outputPos += literal.length;
  };

  for (let m = re.exec(original); m; m = re.exec(original)) {
    expectLiteral(original.slice(originalPos, m.index));
    const value = expectedValue(m[1]!, v);
    expect(output.slice(outputPos, outputPos + value.length)).toBe(value);
    outputPos += value.length;
    originalPos = m.index + m[0].length;
  }
  expectLiteral(original.slice(originalPos));
  expect(outputPos).toBe(output.length); // nothing extra at the end
}

describe("seed.md fidelity", () => {
  it("contains exactly the four templates, in order", () => {
    expect(templates.map((t) => t.key)).toEqual(["template_1", "template_2", "template_3", "template_4"]);
  });

  it("has LF endings, no BOM, valid UTF-8", () => {
    const raw = readFileSync(SEED_PATH);
    expect(raw.includes(0x0d)).toBe(false);
    expect(raw[0]).not.toBe(0xef);
    expect(raw.toString("utf8")).not.toContain("�");
  });

  it.each(Object.keys(PINNED))("%s body matches its pinned sha256 and byte length", (key) => {
    const body = byKey(key).body;
    expect(Buffer.byteLength(body, "utf8")).toBe(PINNED[key]!.bytes);
    expect(createHash("sha256").update(body, "utf8").digest("hex")).toBe(PINNED[key]!.sha256);
  });

  it("keeps trailing spaces and ends without a trailing newline", () => {
    const t1 = byKey("template_1").body;
    expect(t1).toContain("relevent to {{Company}}, \n"); // trailing space kept
    for (const t of templates) expect(t.body.endsWith("\n")).toBe(false);
  });

  it("keeps the 'Proof of work' blocks and literal dataset names", () => {
    for (const t of templates) expect(t.body).toContain("Proof of work:\n1. Delivery ETA prediction + Dark Store Analysis:");
    const t3 = byKey("template_3").body;
    expect(t3).toContain("ZOMATO and BLINKIT Project plus point i used Zomato and Blinkit datset");
  });
});

describe("placeholder inventory", () => {
  const count = (body: string, name: string) => body.split(`{{${name}}}`).length - 1;
  const expected: Record<string, Record<string, number>> = {
    template_1: { first_name: 1, Company: 2, COMPANY_UPPER: 0 },
    template_2: { first_name: 1, Company: 1, COMPANY_UPPER: 2 },
    template_3: { first_name: 1, Company: 2, COMPANY_UPPER: 0 },
    template_4: { first_name: 1, Company: 1, COMPANY_UPPER: 0 },
  };

  it.each(Object.keys(expected))("%s uses exactly the expected placeholders and no others", (key) => {
    const { body } = byKey(key);
    for (const [name, n] of Object.entries(expected[key]!)) expect(count(body, name), name).toBe(n);
    const total = Object.values(expected[key]!).reduce((a, b) => a + b, 0);
    expect(findUnresolvedPlaceholders(body)).toHaveLength(total);
  });
});

describe("renderTemplate: byte-for-byte except at placeholders", () => {
  for (const key of ["template_1", "template_2", "template_3", "template_4"]) {
    for (const sample of SAMPLES) {
      it(`${key} / ${sample.label}`, () => {
        const original = byKey(key).body;
        const output = renderTemplate(original, sample.values);
        assertOnlyPlaceholdersDiffer(original, output, sample.values);
        // all three placeholders are gone, and nothing was introduced by substitution
        expect(output).not.toContain("{{Company}}");
        expect(output).not.toContain("{{COMPANY_UPPER}}");
        expect(output.startsWith(`Hey ${sample.values.firstName}, I'm Afreen`)).toBe(true);
      });
    }
  }

  it("the oracle really detects drift (sanity check on the test itself)", () => {
    const original = byKey("template_1").body;
    const values = SAMPLES[0]!.values;
    const tampered = renderTemplate(original, values).replace("relevent", "relevant");
    expect(() => assertOnlyPlaceholdersDiffer(original, tampered, values)).toThrow();
  });

  it("template 2 upper-cases the company, template 3 leaves dataset names alone", () => {
    const v = { firstName: "Priya", company: "Zepto" };
    expect(renderTemplate(byKey("template_2").body, v)).toContain("2 curated ZEPTO Project .");
    const t3 = renderTemplate(byKey("template_3").body, { firstName: "Priya", company: "Swiggy" });
    expect(t3).toContain("2 curated ZOMATO and BLINKIT Project plus point i used Zomato and Blinkit datset");
    expect(t3).toContain("fit in Swiggy.");
  });

  it("does not re-scan substituted values", () => {
    const out = renderTemplate("Hi {{first_name}} at {{Company}}", { firstName: "{{Company}}", company: "X" });
    expect(out).toBe("Hi {{Company}} at X");
  });

  it("leaves a placeholder visible when its value is blank", () => {
    const out = renderTemplate("Hey {{first_name}} at {{Company}} ({{COMPANY_UPPER}})", { firstName: "Priya", company: "  " });
    expect(out).toBe("Hey Priya at {{Company}} ({{COMPANY_UPPER}})");
    expect(findUnresolvedPlaceholders(out)).toEqual(["{{Company}}", "{{COMPANY_UPPER}}"]);
  });

  it("is case-sensitive: {{company}} is not a placeholder", () => {
    const out = renderTemplate("{{company}} {{Company}}", { firstName: "A", company: "Zepto" });
    expect(out).toBe("{{company}} Zepto");
  });
});

describe("firstNameFromFullName", () => {
  it.each([
    ["Priya Sharma", "Priya"],
    ["  Priya   Sharma  ", "Priya"],
    ["Priya", "Priya"],
    ["", ""],
    ["   ", ""],
  ])("%j -> %j", (input, expected) => {
    expect(firstNameFromFullName(input)).toBe(expected);
  });
});

describe("category -> default template", () => {
  it("maps each category to the required template", () => {
    const expected = {
      quick_commerce: "template_2",
      food_delivery: "template_3",
      other_relevant: "template_1",
      small_startup: "template_4",
    } as const;
    for (const category of COMPANY_CATEGORIES) {
      expect(pickDefaultTemplate(category, templates)?.key, category).toBe(expected[category]);
    }
  });

  it("every category has exactly one default template", () => {
    for (const category of COMPANY_CATEGORIES) {
      expect(templates.filter((t) => t.defaultCategory === category)).toHaveLength(1);
    }
  });

  it("only template 4 carries the anime warning", () => {
    expect(byKey("template_4").warning).toMatch(/anime/i);
    for (const key of ["template_1", "template_2", "template_3"]) expect(byKey(key).warning).toBeNull();
    // the warning is metadata only: the body line itself is untouched
    expect(byKey("template_4").body).toContain("as a certified anime lover, love your work and company");
  });
});

describe("parseSeed strictness", () => {
  const wrap = (extra: string, body = "Hello  ") =>
    `intro\n\n## template_1\n\n- name: T\n${extra}\n\`\`\`text\n${body}\n\`\`\`\n`;

  it("does not trim body lines", () => {
    expect(parseSeed(wrap("")).at(0)?.body).toBe("Hello  ");
  });
  it("rejects CRLF", () => expect(() => parseSeed(wrap("").replace(/\n/g, "\r\n"))).toThrow(/LF/));
  it("rejects unknown metadata keys", () => expect(() => parseSeed(wrap("- colour: red\n"))).toThrow(/unknown metadata/));
  it("rejects an unknown category", () => expect(() => parseSeed(wrap("- default_category: nope\n"))).toThrow(/default_category/));
  it("rejects a missing body", () => expect(() => parseSeed("## template_1\n\n- name: T\n")).toThrow(/no .*body/));
  it("rejects an unterminated fence", () => expect(() => parseSeed("## template_1\n- name: T\n```text\nabc\n")).toThrow(/unterminated/));
  it("rejects duplicate keys", () => {
    const one = "## template_1\n- name: T\n```text\nx\n```\n";
    expect(() => parseSeed(one + one)).toThrow(/duplicate/);
  });
});
