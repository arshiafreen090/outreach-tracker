export type EmailKind = "accept" | "message" | "job_alert" | "other";

export interface Classification {
  /** Sent by LinkedIn and verified by Gmail (DKIM). Untrusted mail is never acted on. */
  trusted: boolean;
  untrustedReason: string | null;
  kind: EmailKind;
}

export interface ClassifyInput {
  fromAddress: string | null;
  /** Gmail's own Authentication-Results header, lower-cased (Gmail prepends it, so it is the first one). */
  authenticationResults: string | null;
  /** LinkedIn's X-LinkedIn-Class header, e.g. INVITE-ACCEPT or SAVEDSEARCH. */
  linkedinClass: string | null;
  /** LinkedIn's X-LinkedIn-Template header, e.g. email_accept_invite_single_01. */
  linkedinTemplate: string | null;
  subject: string | null;
}

const DKIM_LINKEDIN = /dkim=pass[^;]*header\.i=@(?:[a-z0-9-]+\.)*linkedin\.com/;

/**
 * Anyone can write "From: LinkedIn", so a message only counts if it is from @linkedin.com AND
 * Gmail verified a DKIM signature for a linkedin.com domain. Anything else is ignored.
 */
export function classifyLinkedIn(input: ClassifyInput): Classification {
  const from = input.fromAddress ?? "";
  const auth = input.authenticationResults ?? "";

  let untrustedReason: string | null = null;
  if (!/@linkedin\.com$/.test(from)) untrustedReason = `Sender ${from || "(none)"} is not a linkedin.com address`;
  else if (!auth.startsWith("mx.google.com")) untrustedReason = "No Gmail authentication result on this message";
  else if (!DKIM_LINKEDIN.test(auth)) untrustedReason = "Gmail did not verify a linkedin.com DKIM signature";
  if (untrustedReason) return { trusted: false, untrustedReason, kind: "other" };

  const cls = (input.linkedinClass ?? "").toUpperCase();
  const template = (input.linkedinTemplate ?? "").toLowerCase();

  let kind: EmailKind = "other";
  if (cls === "INVITE-ACCEPT" || template.startsWith("email_accept_invite")) kind = "accept";
  else if (cls === "SAVEDSEARCH" || template.startsWith("email_job_alert")) kind = "job_alert";
  else if (/MSG|MESSAGE/.test(cls) || /message/.test(template)) kind = "message";
  else if (!cls && !template && from === "invitations@linkedin.com" && /accepted your invitation/i.test(input.subject ?? "")) kind = "accept";

  return { trusted: true, untrustedReason: null, kind };
}
