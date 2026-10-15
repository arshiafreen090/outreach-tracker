import type { PersonStatus } from "./db-types";

export const STATUS_LABELS: Record<PersonStatus, string> = {
  new: "New",
  requested: "Requested",
  accepted: "Accepted",
  messaged: "Messaged",
  replied: "Replied",
  follow_up_due: "Follow-up due",
  referral: "Referral",
  interview: "Interview",
  offer: "Offer",
  dead: "Dead",
};

export const PERSON_STATUSES = Object.keys(STATUS_LABELS) as PersonStatus[];

export const isPersonStatus = (value: unknown): value is PersonStatus =>
  typeof value === "string" && (PERSON_STATUSES as string[]).includes(value);
