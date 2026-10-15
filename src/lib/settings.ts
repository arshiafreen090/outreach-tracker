export interface AppSettings {
  /** Messaged with no reply after this many days -> follow-up due. */
  followUpDays: number;
  /** Connection request still pending after this many days -> nudge. */
  pendingNudgeDays: number;
  /** Off = initials avatars; nothing is loaded from LinkedIn's image CDN. */
  showPhotos: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  followUpDays: 5,
  pendingNudgeDays: 7,
  showPhotos: true,
};

const MAX_DAYS = 365;

function days(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DAYS
    ? value
    : fallback;
}

/** Tolerant: missing or malformed rows fall back to defaults instead of breaking the dashboard. */
export function parseSettings(rows: readonly { key: string; value: unknown }[]): AppSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    followUpDays: days(byKey.get("follow_up_days"), DEFAULT_SETTINGS.followUpDays),
    pendingNudgeDays: days(byKey.get("pending_nudge_days"), DEFAULT_SETTINGS.pendingNudgeDays),
    showPhotos: typeof byKey.get("show_photos") === "boolean" ? (byKey.get("show_photos") as boolean) : DEFAULT_SETTINGS.showPhotos,
  };
}

/** Parses a user-typed day count; returns null when it isn't a whole number in 1..365. */
export function parseDaysInput(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= MAX_DAYS ? n : null;
}
