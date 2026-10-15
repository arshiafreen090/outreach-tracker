import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, asUser, makeDb, OWNER_EMAIL, readRepoFile, scalar } from "./helpers/db";
import { parseSeed } from "@/lib/templates/seed-parser";
import { seedTemplates } from "@/lib/templates/seed";
import type { SeedTemplate } from "@/lib/templates/seed-parser";

let db: PGlite;
let template2: string; // id of Template 2 (version 1 exists)

async function logRequest(name: string, opts: { key?: string | null; company?: string | null; category?: string; at?: string } = {}) {
  return scalar<string>(
    db,
    `select log_request($1, $2, $3, 'Data Analyst', $4, $5::company_category, coalesce($6::timestamptz, now())) as v`,
    [name, opts.key ? `https://www.linkedin.com/${opts.key}/` : null, opts.key ?? null, opts.company ?? null, opts.category ?? "other_relevant", opts.at ?? null],
  );
}

const person = async (id: string) =>
  (await db.query<{ status: string; company_id: string | null; company_name_raw: string | null; role: string | null }>(
    "select status, company_id, company_name_raw, role from people where id = $1",
    [id],
  )).rows[0]!;

const eventTypes = async (id: string) =>
  (await db.query<{ type: string }>("select type from outreach_events where person_id = $1 order by occurred_at, created_at", [id])).rows.map((r) => r.type);

beforeAll(async () => {
  db = await makeDb();
  // minimal template rows via the real seeder path
  const store = {
    findTemplateId: async (key: string) => (await db.query<{ id: string }>("select id from templates where key=$1", [key])).rows[0]?.id ?? null,
    createTemplate: async (t: SeedTemplate) =>
      (await db.query<{ id: string }>("insert into templates (key,name,description,warning,default_category) values ($1,$2,$3,$4,$5) returning id", [t.key, t.name, t.description, t.warning, t.defaultCategory])).rows[0]!.id,
    addVersion: async (id: string, body: string, note: string) => void (await db.query("insert into template_versions (template_id, body, note) values ($1,$2,$3)", [id, body, note])),
    getVersionBody: async (id: string, v: number) => (await db.query<{ body: string }>("select body from template_versions where template_id=$1 and version=$2", [id, v])).rows[0]?.body ?? null,
  };
  await seedTemplates(store, parseSeed(readRepoFile("templates/seed.md")));
  template2 = await scalar<string>(db, "select id as v from templates where key = 'template_2'");
});

afterAll(async () => {
  await db.close();
});

describe("log_request", () => {
  it("creates a requested person, the company and a 'requested' event", async () => {
    const id = await logRequest("Priya Sharma", { key: "in/priya-sharma", company: "  Zepto ", category: "quick_commerce" });
    const p = await person(id);
    expect(p.status).toBe("requested");
    expect(p.role).toBe("Data Analyst");
    expect(p.company_name_raw).toBe("Zepto");
    expect(await eventTypes(id)).toEqual(["requested"]);
    expect(await scalar<string>(db, "select category::text as v from companies where id = $1", [p.company_id])).toBe("quick_commerce");
  });

  it("reuses an existing company case-insensitively and keeps its category", async () => {
    await logRequest("Second Person", { key: "in/second", company: "ZEPTO", category: "small_startup" });
    expect(await scalar<number>(db, "select count(*)::int as v from companies where lower(name) = 'zepto'")).toBe(1);
    expect(await scalar<string>(db, "select category::text as v from companies where lower(name) = 'zepto'")).toBe("quick_commerce");
  });

  it("works without a company, a role or a date, and honours a backdated date", async () => {
    const id = await logRequest("No Company", { key: "in/no-company", at: "2026-09-20T12:00:00Z" });
    expect((await person(id)).company_id).toBeNull();
    const at = await scalar<Date>(db, "select occurred_at as v from outreach_events where person_id = $1", [id]);
    expect(at.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  it("rejects a duplicate profile and writes nothing for the failed attempt", async () => {
    await logRequest("Dup One", { key: "in/dup" });
    const before = await scalar<number>(db, "select count(*)::int as v from people");
    await expect(logRequest("Dup Two", { key: "in/dup", company: "Brand New Co" })).rejects.toMatchObject({ code: "23505" });
    expect(await scalar<number>(db, "select count(*)::int as v from people")).toBe(before);
    // the whole function is one statement: the company inserted before the failure is rolled back too
    expect(await scalar<number>(db, "select count(*)::int as v from companies where name = 'Brand New Co'")).toBe(0);
  });

  it("rejects a blank name", async () => {
    await expect(logRequest("   ", { key: "in/blank" })).rejects.toThrow();
  });
});

describe("mark_accepted", () => {
  it("moves requested -> accepted once, and is idempotent", async () => {
    const id = await logRequest("Accept Me", { key: "in/accept-me" });
    await db.query("select mark_accepted($1)", [id]);
    await db.query("select mark_accepted($1)", [id]);
    expect((await person(id)).status).toBe("accepted");
    expect(await eventTypes(id)).toEqual(["requested", "accepted"]);
  });

  it("never downgrades a person who is further along", async () => {
    const id = await logRequest("Further Along", { key: "in/further" });
    await db.query("update people set status = 'replied' where id = $1", [id]);
    await db.query("select mark_accepted($1)", [id]);
    expect((await person(id)).status).toBe("replied");
  });

  it("fails for an unknown person", async () => {
    await expect(db.query("select mark_accepted(gen_random_uuid())")).rejects.toThrow(/person_not_found/);
  });
});

describe("mark_message_sent", () => {
  const send = (id: string, text = "Hey Priya, I'm Afreen! ", allow = false, version = 1) =>
    scalar<string>(db, "select mark_message_sent($1, $2, $3, $4, $5) as v", [id, template2, version, text, allow]);

  it("stores the exact text, the template version, a 'messaged' event, and the new status", async () => {
    const id = await logRequest("Send To Me", { key: "in/send-to-me" });
    await db.query("select mark_accepted($1)", [id]);
    await send(id, "exact text with trailing space  ");
    expect((await person(id)).status).toBe("messaged");
    expect(await eventTypes(id)).toEqual(["requested", "accepted", "messaged"]);
    const m = (await db.query<{ final_text: string; template_version: number }>("select final_text, template_version from messages_sent where person_id = $1", [id])).rows[0]!;
    expect(m).toEqual({ final_text: "exact text with trailing space  ", template_version: 1 });
  });

  it("blocks a second message unless explicitly allowed (duplicate-send prevention)", async () => {
    const id = await logRequest("Twice", { key: "in/twice" });
    await send(id);
    await expect(send(id)).rejects.toThrow(/already_messaged/);
    expect(await scalar<number>(db, "select count(*)::int as v from messages_sent where person_id = $1", [id])).toBe(1);
    await send(id, "follow up text", true);
    expect(await scalar<number>(db, "select count(*)::int as v from messages_sent where person_id = $1", [id])).toBe(2);
  });

  it("leaves nothing behind when the template version does not exist", async () => {
    const id = await logRequest("Bad Version", { key: "in/bad-version" });
    await expect(send(id, "x", false, 99)).rejects.toThrow(/foreign key/i);
    expect(await eventTypes(id)).toEqual(["requested"]);
    expect((await person(id)).status).toBe("requested");
  });

  it("rejects an empty message and an unknown person", async () => {
    const id = await logRequest("Empty", { key: "in/empty" });
    await expect(send(id, "   ")).rejects.toThrow(/empty_message/);
    await expect(send("00000000-0000-0000-0000-000000000000")).rejects.toThrow(/person_not_found/);
  });

  it("does not downgrade a person who already replied", async () => {
    const id = await logRequest("Replied", { key: "in/replied" });
    await db.query("update people set status = 'replied' where id = $1", [id]);
    await send(id, "another note", true);
    expect((await person(id)).status).toBe("replied");
  });
});

describe("set_person_company", () => {
  it("creates or links the company and keeps the raw text", async () => {
    const id = await logRequest("Needs Company", { key: "in/needs-company" });
    await db.query("select set_person_company($1, 'Swiggy', 'food_delivery')", [id]);
    const p = await person(id);
    expect(p.company_name_raw).toBe("Swiggy");
    expect(await scalar<string>(db, "select category::text as v from companies where id = $1", [p.company_id])).toBe("food_delivery");
  });
});

describe("privileges", () => {
  it("lets the signed-in owner call the functions, and nobody else", async () => {
    const id = await asUser(db, "authenticated", OWNER_EMAIL, () => logRequest("By Auth", { key: "in/by-auth" }));
    expect(id).toBeTruthy();
    await asRole(db, "anon", async () => {
      await expect(logRequest("By Anon", { key: "in/by-anon" })).rejects.toThrow(/permission denied/i);
      await expect(db.query("select mark_accepted($1)", [id])).rejects.toThrow(/permission denied/i);
    });
  });

  it("applies RLS inside the functions: a role with no policy can't write through them", async () => {
    await asRole(db, "outsider", async () => {
      await expect(logRequest("By Outsider", { key: "in/by-outsider" })).rejects.toThrow(/row-level security|violates/i);
    });
  });
});
