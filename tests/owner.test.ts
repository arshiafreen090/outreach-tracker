import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, makeDb, OWNER_EMAIL, scalar } from "./helpers/db";

let db: PGlite;

beforeAll(async () => {
  db = await makeDb();
  await db.query("insert into companies (name, category) values ('Seeded Co', 'small_startup')");
  await db.query("insert into people (full_name, profile_url_key) values ('Secret Person', 'in/secret-person')");
});

afterAll(async () => {
  await db.close();
});

const count = (table: string) => scalar<number>(db, `select count(*)::int as v from ${table}`);

describe("owner-only access (a stranger who signs up gets nothing)", () => {
  it("lets the owner in", async () => {
    await asUser(db, "authenticated", OWNER_EMAIL, async () => {
      expect(await count("people")).toBe(1);
      expect(await count("companies")).toBe(1);
      expect(await scalar<boolean>(db, "select is_owner() as v")).toBe(true);
    });
  });

  it("matches the email case-insensitively", async () => {
    await asUser(db, "authenticated", "  Owner@Example.COM ", async () => {
      expect(await count("people")).toBe(1);
    });
  });

  it("shows another signed-in user no rows at all", async () => {
    await asUser(db, "authenticated", "stranger@example.com", async () => {
      for (const table of ["people", "companies", "templates", "template_versions", "messages_sent", "settings", "jobs", "email_ingest_log", "outreach_events"]) {
        expect(await count(table), table).toBe(0);
      }
      expect(await count("people_overview")).toBe(0); // the views must not leak either
      expect(await count("templates_current")).toBe(0);
      expect(await scalar<boolean>(db, "select is_owner() as v")).toBe(false);
    });
  });

  it("stops another signed-in user from writing, directly or through the functions", async () => {
    await asUser(db, "authenticated", "stranger@example.com", async () => {
      await expect(db.query("insert into companies (name, category) values ('Evil', 'small_startup')")).rejects.toThrow(/row-level security/i);
      await expect(
        db.query("select log_request('Evil Person', null, 'in/evil', null, null, 'other_relevant', now())"),
      ).rejects.toThrow(/row-level security/i);
      await expect(db.query("update settings set value = '1' where key = 'follow_up_days'")).resolves.toMatchObject({ affectedRows: 0 });
      await expect(db.query("delete from people")).resolves.toMatchObject({ affectedRows: 0 });
    });
    expect(await count("people")).toBe(1);
    expect(await count("companies")).toBe(1);
  });

  it("gives a signed-in user with no email claim nothing", async () => {
    await asUser(db, "authenticated", null, async () => {
      expect(await count("people")).toBe(0);
      expect(await scalar<boolean>(db, "select is_owner() as v")).toBe(false);
    });
  });

  it("gives nobody access until an owner is registered", async () => {
    await db.query("delete from app_owner");
    try {
      await asUser(db, "authenticated", OWNER_EMAIL, async () => {
        expect(await count("people")).toBe(0);
      });
    } finally {
      await db.query("insert into app_owner (email) values ($1)", [OWNER_EMAIL]);
    }
  });

  it("keeps app_owner itself unreadable and unwritable by signed-in users", async () => {
    await asUser(db, "authenticated", OWNER_EMAIL, async () => {
      await expect(db.query("select * from app_owner")).rejects.toThrow(/permission denied/i);
      await expect(db.query("insert into app_owner (email) values ('stranger@example.com')")).rejects.toThrow(/permission denied/i);
    });
    await asUser(db, "anon", null, async () => {
      await expect(db.query("select * from app_owner")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select is_owner()")).rejects.toThrow(/permission denied/i);
    });
  });

  it("only accepts a normalised owner email", async () => {
    await expect(db.query("insert into app_owner (email) values ('Mixed@Case.com')")).rejects.toThrow(/check/i);
    await expect(db.query("insert into app_owner (email) values ('')")).rejects.toThrow(/check/i);
  });
});
