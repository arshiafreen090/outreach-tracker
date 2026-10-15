import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_SECRET_LENGTH = 32;

/**
 * Checks `Authorization: Bearer <secret>` against the shared secret in constant time.
 * Fails closed: an unset or short server secret rejects everything.
 */
export function verifyBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  if (!match) return false;
  // Hash both sides so the comparison is over equal-length buffers whatever was sent.
  const given = createHash("sha256").update(match[1]!).digest();
  const wanted = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, wanted);
}
