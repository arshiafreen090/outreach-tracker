"use client";

import { useState } from "react";
import { safeHttpUrl } from "@/lib/urls";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Initials avatar, or the photo when allowed. The image URL points at LinkedIn's CDN and is
 * loaded by the visitor's own browser, never fetched server-side, and sent without a Referer.
 * Turning "show photos" off in Settings means no request to that CDN is ever made.
 */
export function Avatar({ name, photoUrl, showPhotos }: { name: string; photoUrl: string | null; showPhotos: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = showPhotos ? safeHttpUrl(photoUrl) : null;
  return (
    <div className="avatar" aria-hidden="true">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- a plain <img> keeps this to a single, referrer-less request
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        initials(name)
      )}
    </div>
  );
}
