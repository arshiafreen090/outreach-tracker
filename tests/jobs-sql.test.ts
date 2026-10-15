import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, asUser, makeDb, OWNER_EMAIL, scalar } from "./helpers/db";

let db: PGlite;
beforeAll(async () => {
  db = await makeDb();
  await db.query("insert into companies (name, category) values ('Zepto', 'quick_commerce')");
});
afterAll(async () => {
  await db.close();
});

interface Job {
  source?: string;
  id: string;
  title?: string;
  company?: string | null;
  location?: string | null;
  url?: string | null;
  family?: string;
  intern?: boolean;
  soft?: string | null;
  saved?: string | null;
}
const upsert = (j: Job) =>
  scalar<string>(
    db,
    "select upsert_job($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, null, '2026-10-13T20:00:00Z', null) as v",
    [j.source ?? "linkedin-alert", j.id, j.title ?? "Data Analyst", j.company === undefined ? "Acme" : j.company, j.location === undefined ? "Bengaluru" : j.location, "Hybrid", j.url === undefined ? "https://www.linkedin.com/jobs/view/1/" : j.url, j.saved ?? "Data Analyst", j.family ?? "data_analytics", j.intern ?? false, j.soft === undefined ? null : j.soft],
  );
const row = async (key: string) =>
  (await db.query<Record<string, unknown>>("select * from jobs where dedupe_key = $1", [key])).rows[0];

describe("upsert_job", () => {
  it("stores a job with everything the feed shows", async () => {
    expect(await upsert({ id: "100", title: "  Senior Analyst ", company: "Acme", location: " Pune ", intern: true, family: "data_analytics", soft: "acme|senior analyst|pune" })).toBe("inserted");
    expect(await row("linkedin-alert:100")).toMatchObject({
      title: "Senior Analyst",
      company_name: "Acme",
      company_id: null,
      location: "Pune",
      work_mode: "Hybrid",
      saved_search: "Data Analyst",
      role_family: "data_analytics",
      is_internship: true,
      status: "new",
      source: "linkedin-alert",
      seen_in: ["linkedin-alert"],
    });
  });

  it("links the job to a company you track, ignoring case and spacing", async () => {
    await upsert({ id: "101", company: "  ZEPTO " });
    expect(await scalar<string>(db, "select company_name as v from jobs where dedupe_key = 'linkedin-alert:101'")).toBe("ZEPTO");
    expect(await scalar<boolean>(db, "select company_id is not null as v from jobs where dedupe_key = 'linkedin-alert:101'")).toBe(true);
    await upsert({ id: "102", company: "Nobody Known" });
    expect(await scalar<boolean>(db, "select company_id is null as v from jobs where dedupe_key = 'linkedin-alert:102'")).toBe(true);
  });

  it("copes with a missing company, location and URL", async () => {
    expect(await upsert({ id: "103", company: null, location: null, url: null })).toBe("inserted");
    expect(await row("linkedin-alert:103")).toMatchObject({ company_name: null, location: null, url: null });
  });

  it("ignores the same job arriving again, however often", async () => {
    await upsert({ id: "110" });
    expect(await upsert({ id: "110", title: "Changed title" })).toBe("duplicate");
    expect(await upsert({ id: "110" })).toBe("duplicate");
    expect(await scalar<number>(db, "select count(*)::int as v from jobs where dedupe_key = 'linkedin-alert:110'")).toBe(1);
    expect((await row("linkedin-alert:110"))!.title).toBe("Data Analyst");
  });

  it("never undoes your triage when the job shows up again", async () => {
    await upsert({ id: "120" });
    await db.query("update jobs set status = 'dismissed' where dedupe_key = 'linkedin-alert:120'");
    await upsert({ id: "120" });
    expect((await row("linkedin-alert:120"))!.status).toBe("dismissed");
    await db.query("update jobs set status = 'applied' where dedupe_key = 'linkedin-alert:120'");
    await upsert({ id: "120" });
    expect((await row("linkedin-alert:120"))!.status).toBe("applied");
  });

  it("recognises the same opening from another source, records both sources, and adds no second row", async () => {
    await upsert({ id: "130", company: "Beta Co", soft: "beta|ml intern|pune" });
    expect(await upsert({ source: "greenhouse:betaco", id: "9001", company: "Beta Co", soft: "beta|ml intern|pune" })).toBe("duplicate_soft");
    expect(await upsert({ source: "greenhouse:betaco", id: "9001", company: "Beta Co", soft: "beta|ml intern|pune" })).toBe("duplicate_soft");
    expect(await upsert({ source: "lever:beta", id: "abc", company: "Beta Co", soft: "beta|ml intern|pune" })).toBe("duplicate_soft");
    expect(await scalar<number>(db, "select count(*)::int as v from jobs where soft_key = 'beta|ml intern|pune'")).toBe(1);
    expect((await row("linkedin-alert:130"))!.seen_in).toEqual(["linkedin-alert", "greenhouse:betaco", "lever:beta"]);
  });

  it("keeps different openings apart", async () => {
    await upsert({ id: "140", soft: "gamma|analyst|pune" });
    expect(await upsert({ id: "141", soft: "gamma|analyst|mumbai" })).toBe("inserted");
    expect(await upsert({ id: "142", soft: null })).toBe("inserted");
    expect(await upsert({ id: "143", soft: null })).toBe("inserted"); // no soft key: nothing to compare
  });

  it("rejects incomplete input", async () => {
    await expect(upsert({ id: "  " })).rejects.toThrow(/invalid_job/);
    await expect(upsert({ id: "150", title: "   " })).rejects.toThrow(/invalid_job/);
    await expect(upsert({ source: " ", id: "151" })).rejects.toThrow(/invalid_job/);
  });

  it("refuses a link that isn't http(s), and an unknown family", async () => {
    await expect(upsert({ id: "160", url: "javascript:alert(1)" })).rejects.toThrow(/jobs_url_http_check|check/i);
    await expect(upsert({ id: "161", family: "wizard" })).rejects.toThrow(/check/i);
  });
});

describe("jobs and sources: constraints", () => {
  it("accepts the four statuses and nothing else", async () => {
    await upsert({ id: "170" });
    for (const s of ["new", "seen", "applied", "dismissed"]) {
      await db.query("update jobs set status = $1 where dedupe_key = 'linkedin-alert:170'", [s]);
    }
    await expect(db.query("update jobs set status = 'maybe' where dedupe_key = 'linkedin-alert:170'")).rejects.toThrow(/check/i);
  });

  it("job_sources: only known kinds and safe slugs, one row per board", async () => {
    await db.query("insert into job_sources (kind, slug, label) values ('greenhouse', 'acme-corp', 'Acme')");
    await expect(db.query("insert into job_sources (kind, slug) values ('greenhouse', 'acme-corp')")).rejects.toThrow(/unique|duplicate/i);
    await db.query("insert into job_sources (kind, slug) values ('lever', 'acme-corp')"); // same slug, other board
    for (const bad of ["../etc/passwd", "a b", "x/y", "", "-start", "a".repeat(101), "?q=1"]) {
      await expect(db.query("insert into job_sources (kind, slug) values ('ashby', $1)", [bad]), JSON.stringify(bad)).rejects.toThrow(/check/i);
    }
    await expect(db.query("insert into job_sources (kind, slug) values ('workday', 'x')")).rejects.toThrow(/check/i);
  });
});

describe("who may do what", () => {
  it("only the secret key can add jobs; signed-in users and anon cannot", async () => {
    const call = (id: string) =>
      db.query("select upsert_job('s', $1, 'T', null, null, null, null, null, 'other', false, null, null, null, null)", [id]);
    await asRole(db, "authenticated", async () => {
      await expect(call("a1")).rejects.toThrow(/permission denied/i);
    });
    await asRole(db, "anon", async () => {
      await expect(call("a2")).rejects.toThrow(/permission denied/i);
    });
    await asRole(db, "service_role", async () => {
      await call("a3");
    });
    expect(await row("s:a3")).toBeTruthy();
  });

  it("the owner can triage jobs and manage sources; a stranger sees and changes nothing", async () => {
    await upsert({ id: "180" });
    await asUser(db, "authenticated", OWNER_EMAIL, async () => {
      expect(await scalar<number>(db, "select count(*)::int as v from jobs where dedupe_key = 'linkedin-alert:180'")).toBe(1);
      await db.query("update jobs set status = 'seen' where dedupe_key = 'linkedin-alert:180'");
      await db.query("insert into job_sources (kind, slug) values ('ashby', 'owner-added')");
    });
    await asUser(db, "authenticated", "stranger@example.com", async () => {
      expect(await scalar<number>(db, "select count(*)::int as v from jobs")).toBe(0);
      expect(await scalar<number>(db, "select count(*)::int as v from job_sources")).toBe(0);
      const r = await db.query("update jobs set status = 'dismissed'");
      expect(r.affectedRows).toBe(0);
      await expect(db.query("insert into job_sources (kind, slug) values ('ashby', 'stranger')")).rejects.toThrow(/row-level security/i);
    });
    expect((await row("linkedin-alert:180"))!.status).toBe("seen");
    await asUser(db, "anon", null, async () => {
      await expect(db.query("select * from job_sources")).rejects.toThrow(/permission denied/i);
    });
  });
});
