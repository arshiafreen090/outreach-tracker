export interface ProfileUrl {
  /** Canonical link to open: https://www.linkedin.com/in/<slug>/ */
  url: string;
  /** Matching key, e.g. "in/priya-sharma-1a2b3c". Case-insensitive, query/hash/trailing slash removed. */
  key: string;
}

/**
 * Turns whatever was pasted into a canonical LinkedIn profile URL plus a
 * matching key, or null if it isn't a linkedin.com/in/<slug> URL.
 *
 * Format per LinkedIn Help ("Manage your public profile URL"): profiles live at
 * www.linkedin.com/in/<custom part>, the custom part is case-insensitive, and
 * some members have a country subdomain such as ca.linkedin.com/in/<slug>.
 * Only that shape is recognised; anything else returns null instead of guessing.
 */
export function parseProfileUrl(input: string): ProfileUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const host = u.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;

  const [first, slug] = u.pathname.split("/").filter(Boolean);
  if (first?.toLowerCase() !== "in" || !slug) return null;

  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // keep the raw slug if it isn't valid percent-encoding
  }
  return {
    url: `https://www.linkedin.com/in/${slug}/`,
    key: `in/${decoded.normalize("NFC").toLowerCase()}`,
  };
}

/** Only http(s) URLs may become an href. Blocks javascript:, data:, etc. from pasted or emailed data. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
