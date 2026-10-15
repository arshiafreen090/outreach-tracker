import { describe, expect, it } from "vitest";
import { daysWaiting, groupConversations, groupOf, isFollowUpDue } from "@/lib/followups";
import { isPersonStatus, PERSON_STATUSES, STATUS_LABELS } from "@/lib/status";
import { person } from "./helpers/fixtures";

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number, extraHours = 0) => new Date(NOW.getTime() - n * 86_400_000 - extraHours * 3_600_000).toISOString();
const messaged = (over: Parameters<typeof person>[0] = {}) => person({ status: "messaged", last_messaged_at: daysAgo(6), last_replied_at: null, messages_sent_count: 1, ...over });

describe("isFollowUpDue", () => {
  it("is due once the configured number of days has passed with no reply", () => {
    expect(isFollowUpDue(messaged({ last_messaged_at: daysAgo(5) }), 5, NOW)).toBe(true);
    expect(isFollowUpDue(messaged({ last_messaged_at: daysAgo(30) }), 5, NOW)).toBe(true);
  });
  it("is not due a moment before the threshold", () => {
    expect(isFollowUpDue(messaged({ last_messaged_at: daysAgo(4, 23) }), 5, NOW)).toBe(false);
    expect(isFollowUpDue(messaged({ last_messaged_at: daysAgo(0) }), 5, NOW)).toBe(false);
  });
  it("follows the setting, not a fixed number", () => {
    const p = messaged({ last_messaged_at: daysAgo(3) });
    expect(isFollowUpDue(p, 3, NOW)).toBe(true);
    expect(isFollowUpDue(p, 7, NOW)).toBe(false);
  });
  it("is not due if they replied after your last message", () => {
    expect(isFollowUpDue(messaged({ last_messaged_at: daysAgo(10), last_replied_at: daysAgo(8) }), 5, NOW)).toBe(false);
  });
  it("is due again if you messaged after their last reply and they went quiet", () => {
    expect(isFollowUpDue(messaged({ last_messaged_at: daysAgo(6), last_replied_at: daysAgo(12) }), 5, NOW)).toBe(true);
  });
  it("only applies to people you are waiting on", () => {
    for (const status of ["new", "requested", "accepted", "replied", "referral", "interview", "offer", "dead"] as const) {
      expect(isFollowUpDue(messaged({ status }), 5, NOW), status).toBe(false);
    }
  });
  it("counts a status set to follow_up_due by hand, even without a message date", () => {
    expect(isFollowUpDue(person({ status: "follow_up_due", last_messaged_at: null }), 5, NOW)).toBe(true);
  });
  it("is not due when there is no message date", () => {
    expect(isFollowUpDue(messaged({ last_messaged_at: null }), 5, NOW)).toBe(false);
  });
});

describe("daysWaiting", () => {
  it("counts whole days since the last message", () => {
    expect(daysWaiting(messaged({ last_messaged_at: daysAgo(6, 3) }), NOW)).toBe(6);
    expect(daysWaiting(person({ last_messaged_at: null }), NOW)).toBeNull();
  });
});

describe("groupConversations", () => {
  const people = [
    messaged({ id: "due-old", last_messaged_at: daysAgo(20) }),
    messaged({ id: "due-new", last_messaged_at: daysAgo(6) }),
    messaged({ id: "wait-soon", last_messaged_at: daysAgo(4) }),
    messaged({ id: "wait-fresh", last_messaged_at: daysAgo(1) }),
    person({ id: "replied-old", status: "replied", last_messaged_at: daysAgo(15), last_replied_at: daysAgo(10) }),
    person({ id: "replied-new", status: "replied", last_messaged_at: daysAgo(9), last_replied_at: daysAgo(2) }),
    person({ id: "interview", status: "interview", last_messaged_at: daysAgo(30), last_replied_at: daysAgo(20) }),
    person({ id: "dead", status: "dead", last_messaged_at: daysAgo(40) }),
    person({ id: "odd", status: "accepted", last_messaged_at: daysAgo(3) }),
  ];
  const g = groupConversations(people, 5, NOW);
  const ids = (key: keyof typeof g) => g[key].map((p) => p.id);

  it("puts each person in exactly one group", () => {
    expect(Object.values(g).flat()).toHaveLength(people.length);
  });
  it("orders follow-ups and waiting with the longest wait first", () => {
    expect(ids("due")).toEqual(["due-old", "due-new"]);
    expect(ids("waiting")).toEqual(["wait-soon", "wait-fresh"]);
  });
  it("orders replies newest first", () => {
    expect(ids("replied")).toEqual(["replied-new", "replied-old"]);
  });
  it("separates progress, dead and anything else", () => {
    expect(ids("progress")).toEqual(["interview"]);
    expect(ids("closed")).toEqual(["dead"]);
    expect(ids("other")).toEqual(["odd"]);
  });
  it("groupOf agrees with the grouping", () => {
    expect(groupOf(people[0]!, 5, NOW)).toBe("due");
    expect(groupOf(people[2]!, 5, NOW)).toBe("waiting");
  });
});

describe("statuses", () => {
  it("lists all ten, in the order you named them", () => {
    expect(PERSON_STATUSES).toEqual(["new", "requested", "accepted", "messaged", "replied", "follow_up_due", "referral", "interview", "offer", "dead"]);
    expect(Object.keys(STATUS_LABELS)).toEqual(PERSON_STATUSES);
  });
  it("validates unknown values", () => {
    expect(isPersonStatus("dead")).toBe(true);
    for (const bad of ["ghosted", "", null, undefined, 5, "DEAD"]) expect(isPersonStatus(bad)).toBe(false);
  });
});
