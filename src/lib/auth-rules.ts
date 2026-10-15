/**
 * Single-user allowlist. Fails closed: with ALLOWED_EMAIL unset or blank,
 * nobody is allowed. Comparison is case-insensitive.
 */
export function isAllowedEmail(email: unknown, allowed: string | undefined): boolean {
  if (typeof email !== "string" || !allowed) return false;
  const wanted = allowed.trim().toLowerCase();
  return wanted !== "" && email.trim().toLowerCase() === wanted;
}
