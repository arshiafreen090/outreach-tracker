import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSeed, type SeedTemplate } from "@/lib/templates/seed-parser";
import { seedTemplates, type TemplateStore } from "@/lib/templates/seed";
import { asRole as asRoleIn, asUser, makeDb, OWNER_EMAIL, readRepoFile, scalar as scalarIn } from "./helpers/db";

const templates = parseSeed(readRepoFile("templates/seed.md"));

let db: PGlite;

function pgliteStore(d: PGlite): TemplateStore {
  return {
    async findTemplateId(key) {
      const r = await d.query<{ id: string }>("select id from templates where key = $1", [key]);
      return r.rows[0]?.id ?? null;
    },
    async createTemplate(t: SeedTemplate) {
      const r = await d.query<{ id: string }>(
        "insert into templates (key, name, description, warning, default_category) values ($1, $2, $3, $4, $5) returning id",
        [t.key, t.name, t.description, t.warning, t.defaultCategory],
      );
      return r.rows[0]!.id;
    },
    async addVersion(templateId, body, note) {
      await d.query("insert into template_versions (template_id, body, note) values ($1, $2, $3)", [templateId, body, note]);
    },
    async getVersionBody(templateId, version) {
      const r = await d.query<{ body: string }>(
        "select body from template_versions where template_id = $1 and version = $2",
        [templateId, version],
      );
      return r.rows[0]?.body ?? null;
    },
  };
}

const asRole = <T>(role: string, fn: () => Promise<T>) => asRoleIn(db, role, fn);
const scalar = <T>(sql: string, params: unknown[] = []) => scalarIn<T>(db, sql, params);

beforeAll(async () => {
  db = await makeDb();
  await seedTemplates(pgliteStore(db), templates);
});

afterAll(async () => {
  await db.close();
});

describe("migration", () => {
  it("enables RLS on every public table", async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(r.rows.map((x) => x.relname).sort()).toEqual(
      ["accept_candidates", "app_owner", "companies", "email_ingest_log", "jobs", "messages_sent", "outreach_events", "people", "settings", "template_versions", "templates"],
    );
    expect(r.rows.filter((x) => !x.relrowsecurity)).toEqual([]);
  });

  it("seeds default settings", async () => {
    const r = await db.query<{ key: string; value: unknown }>("select key, value from settings order by key");
    expect(Object.fromEntries(r.rows.map((x) => [x.key, x.value]))).toEqual({
      follow_up_days: 5,
      pending_nudge_days: 7,
      show_photos: true,
    });
  });
});

describe("template seeding", () => {
  it("stores version 1 of every template byte-for-byte as in seed.md", async () => {
    for (const t of templates) {
      const body = await scalar<string>(
        `select v.body as v from template_versions v join templates x on x.id = v.template_id where x.key = $1 and v.version = 1`,
        [t.key],
      );
      expect(Buffer.from(body, "utf8").equals(Buffer.from(t.body, "utf8")), t.key).toBe(true);
    }
  });

  it("stores the default category and the anime warning", async () => {
    const r = await db.query<{ key: string; default_category: string; warning: string | null }>(
      "select key, default_category, warning from templates order by key",
    );
    expect(r.rows.map((x) => [x.key, x.default_category])).toEqual([
      ["template_1", "other_relevant"],
      ["template_2", "quick_commerce"],
      ["template_3", "food_delivery"],
      ["template_4", "small_startup"],
    ]);
    expect(r.rows.filter((x) => x.warning).map((x) => x.key)).toEqual(["template_4"]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const report = await seedTemplates(pgliteStore(db), templates);
    expect(report.every((x) => x.action === "unchanged")).toBe(true);
    expect(await scalar<number>("select count(*)::int as v from template_versions")).toBe(4);
  });

  it("refuses to continue if the stored version 1 differs from seed.md", async () => {
    const tampered = pgliteStore(db);
    tampered.getVersionBody = async () => "something else";
    await expect(seedTemplates(tampered, templates)).rejects.toThrow(/not byte-identical/);
  });
});

describe("template versions", () => {
  it("assigns the next version automatically and exposes the latest via templates_current", async () => {
    const id = await scalar<string>("select id as v from templates where key = 'template_1'");
    await db.query("insert into template_versions (template_id, body, note) values ($1, 'edited body', 'my tweak')", [id]);
    expect(await scalar<number>("select max(version)::int as v from template_versions where template_id = $1", [id])).toBe(2);
    const current = await db.query<{ version: number; body: string }>("select version, body from templates_current where key = 'template_1'");
    expect(current.rows).toEqual([{ version: 2, body: "edited body" }]);
  });

  it("never lets a version be changed or deleted", async () => {
    await expect(db.query("update template_versions set body = 'x'")).rejects.toThrow(/immutable/);
    await expect(db.query("delete from template_versions")).rejects.toThrow(/immutable/);
  });

  it("allows only one default template per category", async () => {
    await expect(
      db.query("insert into templates (key, name, default_category) values ('dup', 'Dup', 'quick_commerce')"),
    ).rejects.toThrow(/unique|duplicate/i);
    // non-default templates are unlimited
    await db.query("insert into templates (key, name) values ('extra_a', 'A'), ('extra_b', 'B')");
  });
});

describe("constraints", () => {
  it("company names are unique case-insensitively", async () => {
    await db.query("insert into companies (name, category) values ('Zepto', 'quick_commerce')");
    await expect(db.query("insert into companies (name, category) values ('  zepto ', 'quick_commerce')")).rejects.toThrow(/unique|duplicate/i);
    await expect(db.query("insert into companies (name, category) values ('X', 'not_a_category')")).rejects.toThrow();
  });

  it("profile_url_key is unique only when set", async () => {
    await db.query("insert into people (full_name) values ('No Url One'), ('No Url Two')");
    await db.query("insert into people (full_name, profile_url_key) values ('A', 'in/a-person')");
    await expect(db.query("insert into people (full_name, profile_url_key) values ('B', 'in/a-person')")).rejects.toThrow(/unique|duplicate/i);
  });

  it("rejects an invalid person status", async () => {
    await expect(db.query("insert into people (full_name, status) values ('S', 'ghosted')")).rejects.toThrow();
    for (const s of ["new", "requested", "accepted", "messaged", "replied", "follow_up_due", "referral", "interview", "offer", "dead"]) {
      await db.query("insert into people (full_name, status) values ($1, $2)", [`status-${s}`, s]);
    }
  });

  it("makes ingest idempotent per Gmail message", async () => {
    await db.query("insert into email_ingest_log (gmail_message_id, raw_body) values ('msg-1', '<html/>')");
    await expect(db.query("insert into email_ingest_log (gmail_message_id) values ('msg-1')")).rejects.toThrow(/unique|duplicate/i);
  });

  it("dedupes jobs by dedupe_key", async () => {
    await db.query("insert into jobs (title, source, dedupe_key) values ('SDE Intern', 'internshala-email', 'k1')");
    await expect(db.query("insert into jobs (title, source, dedupe_key) values ('SDE Intern', 'naukri-email', 'k1')")).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("messages_sent and people_overview", () => {
  it("only accepts a template version that exists, and records the exact text", async () => {
    const personId = await scalar<string>("insert into people (full_name, status) values ('Priya Sharma', 'accepted') returning id as v");
    const templateId = await scalar<string>("select id as v from templates where key = 'template_2'");

    await expect(
      db.query("insert into messages_sent (person_id, template_id, template_version, final_text) values ($1, $2, 99, 'x')", [personId, templateId]),
    ).rejects.toThrow(/foreign key/i);

    await db.query(
      "insert into messages_sent (person_id, template_id, template_version, final_text) values ($1, $2, 1, $3)",
      [personId, templateId, "Hey Priya, I'm Afreen! (edited) "],
    );
    expect(await scalar<string>("select final_text as v from messages_sent where person_id = $1", [personId])).toBe(
      "Hey Priya, I'm Afreen! (edited) ",
    );
  });

  it("summarises events per person", async () => {
    const personId = await scalar<string>("insert into people (full_name, status) values ('Overview Person', 'replied') returning id as v");
    const events: [string, string][] = [
      ["requested", "2026-10-01T10:00:00Z"],
      ["accepted", "2026-10-03T10:00:00Z"],
      ["messaged", "2026-10-04T10:00:00Z"],
      ["messaged", "2026-10-09T10:00:00Z"],
      ["replied", "2026-10-10T10:00:00Z"],
    ];
    for (const [type, at] of events) {
      await db.query("insert into outreach_events (person_id, type, occurred_at) values ($1, $2, $3)", [personId, type, at]);
    }
    const r = await db.query<Record<string, Date | number | null>>(
      `select requested_at, accepted_at, last_messaged_at, last_replied_at, messages_sent_count::int as n
         from people_overview where id = $1`,
      [personId],
    );
    const row = r.rows[0]!;
    expect((row.requested_at as Date).toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect((row.accepted_at as Date).toISOString()).toBe("2026-10-03T10:00:00.000Z");
    expect((row.last_messaged_at as Date).toISOString()).toBe("2026-10-09T10:00:00.000Z");
    expect((row.last_replied_at as Date).toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(row.n).toBe(0);
  });
});

describe("row level security", () => {
  it("lets the signed-in owner read and write", async () => {
    await asUser(db, "authenticated", OWNER_EMAIL, async () => {
      await db.query("insert into companies (name, category) values ('Swiggy', 'food_delivery')");
      const n = await scalar<number>("select count(*)::int as v from companies");
      expect(n).toBeGreaterThanOrEqual(2);
    });
  });

  it("gives anon nothing", async () => {
    await asRole("anon", async () => {
      await expect(db.query("select * from people")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select * from templates_current")).rejects.toThrow(/permission denied/i);
      await expect(db.query("insert into companies (name, category) values ('Evil', 'small_startup')")).rejects.toThrow(/permission denied/i);
    });
  });

  it("hides every row from a role that has privileges but no policy, including through the views", async () => {
    expect(await scalar<number>("select count(*)::int as v from people")).toBeGreaterThan(0);
    await asRole("outsider", async () => {
      expect(await scalar<number>("select count(*)::int as v from people")).toBe(0);
      expect(await scalar<number>("select count(*)::int as v from messages_sent")).toBe(0);
      expect(await scalar<number>("select count(*)::int as v from template_versions")).toBe(0);
      // security_invoker views must not leak what the tables hide
      expect(await scalar<number>("select count(*)::int as v from people_overview")).toBe(0);
      expect(await scalar<number>("select count(*)::int as v from templates_current")).toBe(0);
    });
  });
});
