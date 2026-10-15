import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, asUser, makeDb, OWNER_EMAIL, scalar } from "./helpers/db";

let db: PGlite;
let n = 0;

beforeAll(async () => {
  db = await makeDb();
});
afterAll(async () => {
  await db.close();
});

const when = "2026-10-13T20:48:00Z";

async function ingestRow(): Promise<string> {
  return scalar<string>(db, "insert into email_ingest_log (gmail_message_id) values ($1) returning id as v", [`msg-${++n}`]);
}

interface Accept {
  name: string;
  key: string;
  headline?: string | null;
  hint?: string | null;
  photo?: string | null;
}
const apply = async (a: Accept, ingestId?: string) =>
  scalar<string>(
    db,
    "select apply_accept($1, $2, $3, $4, $5, $6, $7, $8::timestamptz) as v",
    [ingestId ?? (await ingestRow()), a.name, a.headline ?? null, a.hint ?? null, `https://www.linkedin.com/${a.key}/`, a.key, a.photo ?? null, when],
  );

/** A request you logged (status 'requested'), the way log_request does it. */
const logged = (name: string, key: string | null, company: string | null = null) =>
  scalar<string>(db, "select log_request($1, $2, $3, null, $4, 'quick_commerce', now()) as v", [name, key ? `https://www.linkedin.com/${key}/` : null, key, company]);

const person = async (id: string) =>
  (await db.query<{ status: string; photo_url: string | null; role: string | null; profile_url_key: string | null; profile_url: string | null }>(
    "select status, photo_url, role, profile_url_key, profile_url from people where id = $1",
    [id],
  )).rows[0]!;
const events = async (id: string) =>
  (await db.query<{ type: string; source: string; ingest_id: string | null }>("select type, source, ingest_id from outreach_events where person_id = $1 order by created_at", [id])).rows;
const candidate = async (key: string) =>
  (await db.query<{ status: string; match_method: string | null; person_id: string | null; company_hint: string | null; headline: string | null }>(
    "select status, match_method, person_id, company_hint, headline from accept_candidates where profile_url_key = $1",
    [key],
  )).rows[0];

describe("apply_accept: matching by profile URL", () => {
  it("links the request, records the email as the source, and fills in what you lacked", async () => {
    const id = await logged("Priya Sharma", "in/priya-sharma-1", "Zepto");
    const ingest = await ingestRow();
    const result = await apply({ name: "Priya Sharma", key: "in/priya-sharma-1", headline: "SDE II @Zepto", hint: "Zepto", photo: "https://media.licdn.com/p1" }, ingest);
    expect(result).toBe("linked_url");

    const p = await person(id);
    expect(p).toMatchObject({ status: "accepted", photo_url: "https://media.licdn.com/p1", role: "SDE II @Zepto" });
    expect(await events(id)).toEqual([
      { type: "requested", source: "manual", ingest_id: null },
      { type: "accepted", source: "email", ingest_id: ingest },
    ]);
    expect(await candidate("in/priya-sharma-1")).toMatchObject({ status: "linked", match_method: "url", person_id: id });
  });

  it("keeps the role you typed, but refreshes the photo (the old link is signed and expires)", async () => {
    const id = await logged("Role Keeper", "in/role-keeper");
    await db.query("update people set role = 'My own note', photo_url = 'https://old' where id = $1", [id]);
    await apply({ name: "Role Keeper", key: "in/role-keeper", headline: "From the email", photo: "https://new" });
    expect(await person(id)).toMatchObject({ role: "My own note", photo_url: "https://new" });
  });

  it("never moves someone who is further along back to 'accepted'", async () => {
    const id = await logged("Already Messaged", "in/already-messaged");
    await db.query("update people set status = 'replied' where id = $1", [id]);
    await apply({ name: "Already Messaged", key: "in/already-messaged" });
    expect((await person(id)).status).toBe("replied");
  });

  it("matches the key case-insensitively because keys are lower-cased by the app", async () => {
    const id = await logged("Case Test", "in/case-test");
    expect(await apply({ name: "Whatever Name", key: "in/case-test" })).toBe("linked_url");
    expect((await person(id)).status).toBe("accepted");
  });
});

describe("apply_accept: matching by name", () => {
  it("links the single open request with that name and adopts the email's profile URL", async () => {
    const id = await logged("Unique Name", null);
    const result = await apply({ name: "  unique NAME ", key: "in/unique-name-777" });
    expect(result).toBe("linked_name");
    expect(await person(id)).toMatchObject({ status: "accepted", profile_url_key: "in/unique-name-777", profile_url: "https://www.linkedin.com/in/unique-name-777/" });
    expect(await candidate("in/unique-name-777")).toMatchObject({ match_method: "name", person_id: id });
  });

  it("refuses to guess when two open requests share the name", async () => {
    const a = await logged("Common Name", "in/common-a");
    const b = await logged("Common Name", "in/common-b");
    expect(await apply({ name: "Common Name", key: "in/common-zzz" })).toBe("unmatched");
    expect((await person(a)).status).toBe("requested");
    expect((await person(b)).status).toBe("requested");
  });

  it("ignores people who are no longer 'requested'", async () => {
    const id = await logged("Gone Past", "in/gone-past");
    await db.query("update people set status = 'messaged' where id = $1", [id]);
    expect(await apply({ name: "Gone Past", key: "in/gone-past-other" })).toBe("unmatched");
    expect((await person(id)).status).toBe("messaged");
  });
});

describe("apply_accept: unmatched and repeats", () => {
  it("keeps an unknown accept as a candidate and creates no person", async () => {
    const before = await scalar<number>(db, "select count(*)::int as v from people");
    expect(await apply({ name: "Stranger Danger", key: "in/stranger-danger", headline: "Founder at Beta Labs", hint: "Beta Labs" })).toBe("unmatched");
    expect(await scalar<number>(db, "select count(*)::int as v from people")).toBe(before);
    expect(await candidate("in/stranger-danger")).toMatchObject({ status: "unmatched", person_id: null, company_hint: "Beta Labs", headline: "Founder at Beta Labs" });
  });

  it("is idempotent: the same person in another email, or a re-parse, changes nothing", async () => {
    const id = await logged("Twice Seen", "in/twice-seen");
    expect(await apply({ name: "Twice Seen", key: "in/twice-seen" })).toBe("linked_url");
    expect(await apply({ name: "Twice Seen", key: "in/twice-seen" })).toBe("duplicate");
    expect((await events(id)).filter((e) => e.type === "accepted")).toHaveLength(1);
    expect(await scalar<number>(db, "select count(*)::int as v from accept_candidates where profile_url_key = 'in/twice-seen'")).toBe(1);
  });
});

describe("resolving an unmatched accept", () => {
  const cid = async (key: string) => scalar<string>(db, "select id as v from accept_candidates where profile_url_key = $1", [key]);

  it("link_accept ties it to the request you pick, even if the profile URL differs", async () => {
    const id = await logged("Renamed Person", "in/old-slug");
    await apply({ name: "Totally Different Name", key: "in/new-slug", headline: "Engineer @X", photo: "https://p" });
    await db.query("select link_accept($1, $2)", [await cid("in/new-slug"), id]);
    expect(await candidate("in/new-slug")).toMatchObject({ status: "linked", match_method: "manual", person_id: id });
    const p = await person(id);
    expect(p).toMatchObject({ status: "accepted", photo_url: "https://p", profile_url_key: "in/old-slug" }); // your own key is kept
  });

  it("create_person_from_accept makes an accepted person with the company you give", async () => {
    await apply({ name: "Brand New", key: "in/brand-new", headline: "Analyst @NewCo", hint: "NewCo", photo: "https://q" });
    const personId = await scalar<string>(db, "select create_person_from_accept($1, 'NewCo', 'small_startup') as v", [await cid("in/brand-new")]);
    expect(await person(personId)).toMatchObject({ status: "accepted", role: "Analyst @NewCo", photo_url: "https://q", profile_url_key: "in/brand-new" });
    expect(await scalar<string>(db, "select c.category::text as v from people p join companies c on c.id = p.company_id where p.id = $1", [personId])).toBe("small_startup");
    expect((await events(personId)).map((e) => e.type)).toEqual(["accepted"]);
    expect(await candidate("in/brand-new")).toMatchObject({ status: "linked", person_id: personId });
  });

  it("create_person_from_accept links to a request you logged after the email arrived, instead of duplicating", async () => {
    await apply({ name: "Late Logger", key: "in/late-logger" });
    const logged2 = await logged("Late Logger Typed Differently", "in/late-logger");
    const personId = await scalar<string>(db, "select create_person_from_accept($1) as v", [await cid("in/late-logger")]);
    expect(personId).toBe(logged2);
    expect(await scalar<number>(db, "select count(*)::int as v from people where profile_url_key = 'in/late-logger'")).toBe(1);
  });

  it("dismiss_accept hides it for good: a later email for the same person does not bring it back", async () => {
    await apply({ name: "Not Interested", key: "in/not-interested" });
    await db.query("select dismiss_accept($1)", [await cid("in/not-interested")]);
    expect(await candidate("in/not-interested")).toMatchObject({ status: "dismissed" });
    expect(await apply({ name: "Not Interested", key: "in/not-interested" })).toBe("duplicate");
  });

  it("only works on unmatched candidates, and reports unknown ids", async () => {
    await apply({ name: "Resolve Once", key: "in/resolve-once" });
    const c = await cid("in/resolve-once");
    await db.query("select dismiss_accept($1)", [c]);
    await expect(db.query("select dismiss_accept($1)", [c])).rejects.toThrow(/candidate_not_unmatched/);
    await expect(db.query("select create_person_from_accept($1)", [c])).rejects.toThrow(/candidate_not_unmatched/);
    await expect(db.query("select link_accept($1, gen_random_uuid())", [c])).rejects.toThrow(/candidate_not_unmatched/);
    await expect(db.query("select dismiss_accept(gen_random_uuid())")).rejects.toThrow(/candidate_not_unmatched/);
    await expect(db.query("select link_accept(gen_random_uuid(), gen_random_uuid())")).rejects.toThrow(/candidate_not_found/);
    await apply({ name: "Needs Real Person", key: "in/needs-real-person" });
    await expect(db.query("select link_accept($1, gen_random_uuid())", [await cid("in/needs-real-person")])).rejects.toThrow(/person_not_found/);
  });
});

describe("who may call what", () => {
  const args = ["00000000-0000-0000-0000-000000000000", "X Y", null, null, "https://x", "in/priv-test", null, when];
  const call = () => db.query("select apply_accept($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)", args);

  it("only the secret key (service_role) may apply accepts; signed-in users and anon may not", async () => {
    await asRole(db, "authenticated", async () => {
      await expect(call()).rejects.toThrow(/permission denied/i);
    });
    await asRole(db, "anon", async () => {
      await expect(call()).rejects.toThrow(/permission denied/i);
    });
    await asRole(db, "service_role", async () => {
      await db.query("select apply_accept(null, 'Svc Person', null, null, 'https://x', 'in/svc-person', null, $1::timestamptz)", [when]);
    });
    expect(await candidate("in/svc-person")).toMatchObject({ status: "unmatched" });
  });

  it("candidates are visible and resolvable only to the owner", async () => {
    await apply({ name: "Owner Only", key: "in/owner-only" });
    const id = await scalar<string>(db, "select id as v from accept_candidates where profile_url_key = 'in/owner-only'");
    await asUser(db, "authenticated", "stranger@example.com", async () => {
      expect(await scalar<number>(db, "select count(*)::int as v from accept_candidates")).toBe(0);
      await expect(db.query("select dismiss_accept($1)", [id])).rejects.toThrow(/candidate_not_unmatched/); // RLS hides it, so nothing to dismiss
    });
    await asUser(db, "authenticated", OWNER_EMAIL, async () => {
      expect(await scalar<number>(db, "select count(*)::int as v from accept_candidates where profile_url_key = 'in/owner-only'")).toBe(1);
      await db.query("select dismiss_accept($1)", [id]);
    });
    await asUser(db, "anon", null, async () => {
      await expect(db.query("select * from accept_candidates")).rejects.toThrow(/permission denied/i);
    });
    expect(await candidate("in/owner-only")).toMatchObject({ status: "dismissed" });
  });
});
