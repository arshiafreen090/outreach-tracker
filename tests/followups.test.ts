import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, asUser, makeDb, OWNER_EMAIL, scalar } from "./helpers/db";

let db: PGlite;
let template: string;
let n = 0;

beforeAll(async () => {
  db = await makeDb();
  template = await scalar<string>(db, "insert into templates (key, name) values ('t', 'T') returning id as v");
  await db.query("insert into template_versions (template_id, body) values ($1, 'hello')", [template]);
});
afterAll(async () => {
  await db.close();
});

/** A person who has been messaged: requested -> accepted -> messaged. */
async function messaged(): Promise<string> {
  const id = await scalar<string>(db, "select log_request($1, $2, $3, null, null, 'other_relevant', now()) as v", [`Person ${++n}`, null, `in/p-${n}`]);
  await db.query("select mark_accepted($1)", [id]);
  await db.query("select mark_message_sent($1, $2, 1, 'hi')", [id, template]);
  return id;
}
const status = (id: string) => scalar<string>(db, "select status::text as v from people where id = $1", [id]);
const events = async (id: string) =>
  (await db.query<{ type: string; note: string | null }>("select type, note from outreach_events where person_id = $1 order by created_at, id", [id])).rows;
const overview = async (id: string) =>
  (await db.query<{ last_messaged_at: Date | null; last_replied_at: Date | null; follow_ups_count: number; messages_sent_count: number }>(
    "select last_messaged_at, last_replied_at, follow_ups_count::int, messages_sent_count::int from people_overview where id = $1",
    [id],
  )).rows[0]!;

describe("mark_replied", () => {
  it("records the reply and moves the person to 'replied'", async () => {
    const id = await messaged();
    await db.query("select mark_replied($1, '  asked for my resume  ')", [id]);
    expect(await status(id)).toBe("replied");
    expect((await events(id)).at(-1)).toEqual({ type: "replied", note: "asked for my resume" });
    expect((await overview(id)).last_replied_at).toBeInstanceOf(Date);
  });

  it("never pulls someone back from referral, interview or offer", async () => {
    for (const s of ["referral", "interview", "offer"]) {
      const id = await messaged();
      await db.query("select set_person_status($1, $2)", [id, s]);
      await db.query("select mark_replied($1)", [id]);
      expect(await status(id), s).toBe(s);
    }
  });

  it("revives someone you had written off", async () => {
    const id = await messaged();
    await db.query("select set_person_status($1, 'dead')", [id]);
    await db.query("select mark_replied($1)", [id]);
    expect(await status(id)).toBe("replied");
  });

  it("honours a backdated time and reports unknown people", async () => {
    const id = await messaged();
    await db.query("select mark_replied($1, null, '2026-10-01T10:00:00Z')", [id]);
    expect((await overview(id)).last_replied_at?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    await expect(db.query("select mark_replied(gen_random_uuid())")).rejects.toThrow(/person_not_found/);
  });
});

describe("mark_followed_up", () => {
  it("restarts the no-reply clock and counts the follow-up", async () => {
    const id = await messaged();
    await db.query("update outreach_events set occurred_at = now() - interval '9 days' where person_id = $1 and type = 'messaged'", [id]);
    const before = (await overview(id)).last_messaged_at!;
    await db.query("select mark_followed_up($1, 'second nudge')", [id]);
    const after = await overview(id);
    expect(after.last_messaged_at!.getTime()).toBeGreaterThan(before.getTime());
    expect(after.follow_ups_count).toBe(1);
    expect(after.messages_sent_count).toBe(1); // a follow-up is not a template message
    expect((await events(id)).at(-1)).toEqual({ type: "messaged", note: "follow-up: second nudge" });
  });

  it("uses a plain note when none is given, and counts every follow-up", async () => {
    const id = await messaged();
    await db.query("select mark_followed_up($1)", [id]);
    await db.query("select mark_followed_up($1)", [id]);
    expect((await events(id)).at(-1)?.note).toBe("follow-up");
    expect((await overview(id)).follow_ups_count).toBe(2);
  });

  it("brings 'follow_up_due' back to 'messaged'", async () => {
    const id = await messaged();
    await db.query("select set_person_status($1, 'follow_up_due')", [id]);
    await db.query("select mark_followed_up($1)", [id]);
    expect(await status(id)).toBe("messaged");
  });

  it("only works while you are waiting on a reply", async () => {
    const replied = await messaged();
    await db.query("select mark_replied($1)", [replied]);
    await expect(db.query("select mark_followed_up($1)", [replied])).rejects.toThrow(/not_awaiting_reply/);
    const fresh = await scalar<string>(db, "select log_request('Not Messaged', null, 'in/not-messaged', null, null, 'other_relevant', now()) as v");
    await expect(db.query("select mark_followed_up($1)", [fresh])).rejects.toThrow(/not_awaiting_reply/);
    await expect(db.query("select mark_followed_up(gen_random_uuid())")).rejects.toThrow(/person_not_found/);
  });
});

describe("set_person_status", () => {
  it.each(["new", "requested", "accepted", "messaged", "replied", "follow_up_due", "referral", "interview", "offer", "dead"])("can set %s", async (s) => {
    const id = await messaged();
    await db.query("select set_person_status($1, $2)", [id, s]);
    expect(await status(id)).toBe(s);
  });

  it("rejects a status that does not exist and an unknown person", async () => {
    const id = await messaged();
    await expect(db.query("select set_person_status($1, 'ghosted')", [id])).rejects.toThrow();
    await expect(db.query("select set_person_status(gen_random_uuid(), 'dead')")).rejects.toThrow(/person_not_found/);
  });
});

describe("who may call these", () => {
  it("only the signed-in owner can; a stranger's RLS-hidden view finds nobody; anon is refused", async () => {
    const id = await messaged();
    await asUser(db, "authenticated", OWNER_EMAIL, async () => {
      await db.query("select mark_replied($1)", [id]);
    });
    await asUser(db, "authenticated", "stranger@example.com", async () => {
      await expect(db.query("select set_person_status($1, 'dead')", [id])).rejects.toThrow(/person_not_found/);
      await expect(db.query("select mark_followed_up($1)", [id])).rejects.toThrow(/person_not_found/);
    });
    await asRole(db, "anon", async () => {
      await expect(db.query("select mark_replied($1)", [id])).rejects.toThrow(/permission denied/i);
    });
    expect(await status(id)).toBe("replied");
  });
});
