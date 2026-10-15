/** Dates are shown in this zone so "sent 5 Oct" doesn't shift when the server runs in UTC. */
export const DISPLAY_TIME_ZONE = "Asia/Kolkata";

const DAY_MS = 86_400_000;

/** Whole days elapsed since `then` (never negative). */
export function daysSince(then: string | Date, now: Date = new Date()): number {
  const t = typeof then === "string" ? new Date(then) : then;
  return Math.max(0, Math.floor((now.getTime() - t.getTime()) / DAY_MS));
}

/** Today's calendar date (YYYY-MM-DD) in the display zone. */
export function todayInDisplayZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE }).format(now);
}

/**
 * A <input type="date"> value -> the moment to record. Today means "now";
 * past dates are noon in the display zone (India has no DST, so +05:30 is exact);
 * future or malformed dates return null.
 */
export function dateInputToDate(value: string, now: Date = new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const today = todayInDisplayZone(now);
  if (value === today) return now;
  if (value > today) return null;
  const d = new Date(`${value}T12:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function agoLabel(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(typeof value === "string" ? new Date(value) : value);
}
