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
