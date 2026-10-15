import PostalMime from "postal-mime";

export interface ParsedEmail {
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  html: string | null;
  text: string | null;
  messageId: string | null;
  /** Gmail's verdict on SPF/DKIM/DMARC for this message, lower-cased. Used later to trust the sender. */
  authenticationResults: string | null;
}

/**
 * Parses a Gmail API `raw` value (base64url RFC 2822) into the fields we store.
 * Attachments are ignored. Throws if the message can't be read at all.
 */
export async function parseRawEmail(rawBase64Url: string): Promise<ParsedEmail> {
  const bytes = Buffer.from(rawBase64Url, "base64url");
  const mail = await PostalMime.parse(bytes);

  const header = (name: string): string | null => {
    const hit = mail.headers.find((h) => h.key === name);
    return hit ? String(hit.value).trim() || null : null;
  };

  return {
    fromAddress: mail.from?.address ? mail.from.address.trim().toLowerCase() : null,
    fromName: mail.from?.name?.trim() || null,
    subject: mail.subject?.trim() || null,
    html: mail.html || null,
    text: mail.text || null,
    messageId: mail.messageId?.trim() || null,
    authenticationResults: header("authentication-results")?.toLowerCase() ?? null,
  };
}
