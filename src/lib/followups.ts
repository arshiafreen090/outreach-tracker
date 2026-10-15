import type { PersonRow } from "./db-types";
import { daysSince } from "./time";

/**
 * "Follow-up due" is derived, never stored: you messaged them, they haven't replied since, and
 * at least `followUpDays` days have passed (the clock restarts each time you log a follow-up).
 * A status set to 'follow_up_due' by hand counts as due too.
 */
export function isFollowUpDue(person: PersonRow, followUpDays: number, now: Date = new Date()): boolean {
  if (person.status === "follow_up_due") return true;
  if (person.status !== "messaged" || !person.last_messaged_at) return false;
  if (person.last_replied_at && new Date(person.last_replied_at) >= new Date(person.last_messaged_at)) return false;
  return daysSince(person.last_messaged_at, now) >= followUpDays;
}

/** Whole days since the last message, or null if they were never messaged. */
export function daysWaiting(person: PersonRow, now: Date = new Date()): number | null {
  return person.last_messaged_at ? daysSince(person.last_messaged_at, now) : null;
}

export type ConversationGroup = "due" | "waiting" | "replied" | "progress" | "closed" | "other";

export const GROUP_TITLES: Record<ConversationGroup, string> = {
  due: "Follow-up due",
  waiting: "Waiting for a reply",
  replied: "Replied",
  progress: "Referral, interview or offer",
  closed: "Dead",
  other: "Other",
};

export const GROUP_ORDER: ConversationGroup[] = ["due", "waiting", "replied", "progress", "closed", "other"];

export function groupOf(person: PersonRow, followUpDays: number, now: Date = new Date()): ConversationGroup {
  if (isFollowUpDue(person, followUpDays, now)) return "due";
  switch (person.status) {
    case "messaged":
      return "waiting";
    case "replied":
      return "replied";
    case "referral":
    case "interview":
    case "offer":
      return "progress";
    case "dead":
      return "closed";
    default:
      return "other";
  }
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** Sorts people into groups: longest-waiting first where you must act, most recent first elsewhere. */
export function groupConversations(
  people: readonly PersonRow[],
  followUpDays: number,
  now: Date = new Date(),
): Record<ConversationGroup, PersonRow[]> {
  const groups: Record<ConversationGroup, PersonRow[]> = { due: [], waiting: [], replied: [], progress: [], closed: [], other: [] };
  for (const p of people) groups[groupOf(p, followUpDays, now)].push(p);

  const oldestFirst = (a: PersonRow, b: PersonRow) => time(a.last_messaged_at) - time(b.last_messaged_at);
  const newestReplyFirst = (a: PersonRow, b: PersonRow) => time(b.last_replied_at) - time(a.last_replied_at);
  groups.due.sort(oldestFirst);
  groups.waiting.sort(oldestFirst);
  groups.replied.sort(newestReplyFirst);
  groups.progress.sort(newestReplyFirst);
  groups.closed.sort((a, b) => time(b.last_messaged_at) - time(a.last_messaged_at));
  groups.other.sort((a, b) => time(b.last_messaged_at) - time(a.last_messaged_at));
  return groups;
}
