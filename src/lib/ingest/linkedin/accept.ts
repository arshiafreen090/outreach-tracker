import { parseProfileUrl } from "../../urls";
import { walk, type DomEvent } from "./dom";

export interface Accepter {
  name: string;
  /** The line under the name. LinkedIn truncates long ones with an ellipsis. */
  headline: string | null;
  headlineTruncated: boolean;
  /** Best-effort guess at the employer from the headline. A hint for a human, never applied automatically. */
  companyHint: string | null;
  /** https://www.linkedin.com/in/<slug>/ */
  profileUrl: string;
  /** in/<slug>, lower-cased: how requests are matched. */
  profileKey: string;
  /** A signed, expiring URL on LinkedIn's image CDN. Never downloaded. */
  photoUrl: string | null;
}

const MAX_ACCEPTERS = 25;
const BUTTON_TEXT = /^(message|connect|follow|see all|view profile)$/i;
// Where "the people who accepted" ends and "people you may know" / the footer begin.
const SECTION_END = /^(suggestions from|people you may know|this email was intended for)/i;
const MUTUAL = /mutual connection/i;

const profileOf = (anchors: string[]) => {
  for (let i = anchors.length - 1; i >= 0; i--) {
    const p = parseProfileUrl(anchors[i]!);
    if (p) return p;
  }
  return null;
};

/** Profile pictures live on licdn.com; company logos and UI icons are not photos of a person. */
export function isProfilePhoto(src: string): boolean {
  try {
    const u = new URL(src);
    return (
      u.protocol === "https:" &&
      /(^|\.)licdn\.com$/.test(u.hostname) &&
      /profile-/.test(u.pathname) &&
      !/company-logo|\/sc\/h\//.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/** "Founding team at Cardboard" -> "Cardboard"; "Building Tech@FirstClub | React" -> "FirstClub". */
export function companyHintFromHeadline(headline: string | null): string | null {
  if (!headline) return null;
  const stop = String.raw`(?=\s*(?:[|•·,;()\[\]]|\s[–—-]\s|…|\.\.\.|$))`;
  const at = new RegExp(String.raw`@\s*([^|•·,;()\[\]–—]{2,50}?)${stop}`).exec(headline);
  const word = new RegExp(String.raw`\bat\s+([A-Z][^|•·,;()\[\]–—]{1,50}?)${stop}`).exec(headline);
  const hint = (at?.[1] ?? word?.[1] ?? "").trim().replace(/[\s.…]+$/, "");
  return hint.length >= 2 ? hint : null;
}

/**
 * The people an "accepted your invitation" email is about. Handles the single-person email
 * and the digest ("You have 2 new connections"). Anything after the first "suggestions" or
 * footer marker, or next to a Connect button, is someone else and is ignored.
 */
export function parseAccepters(html: string): Accepter[] {
  const events = walk(html);

  let end = events.length;
  for (const [i, e] of events.entries()) {
    if ((e.type === "text" && SECTION_END.test(e.text)) || (e.type === "anchor" && /\/send-invite\//i.test(e.href))) {
      end = i;
      break;
    }
  }

  interface Card {
    key: string;
    url: string;
    name: string | null;
    nameAt: number;
    photo: string | null;
    firstAt: number;
  }
  const cards = new Map<string, Card>();

  for (let i = 0; i < end; i++) {
    const e: DomEvent = events[i]!;
    const profile = e.type === "anchor" ? parseProfileUrl(e.href) : profileOf(e.anchors);
    if (!profile) continue;
    let card = cards.get(profile.key);
    if (!card) {
      card = { key: profile.key, url: profile.url, name: null, nameAt: -1, photo: null, firstAt: i };
      cards.set(profile.key, card);
    }
    if (e.type === "text" && !card.name && !BUTTON_TEXT.test(e.text)) {
      card.name = e.text;
      card.nameAt = i;
    }
    if (e.type === "img" && !card.photo && isProfilePhoto(e.src)) card.photo = e.src;
  }

  const ordered = [...cards.values()].filter((c) => c.name).sort((a, b) => a.firstAt - b.firstAt).slice(0, MAX_ACCEPTERS);

  return ordered.map((card, index) => {
    const stopAt = ordered[index + 1]?.firstAt ?? end;

    // Photo not inside the profile link: fall back to an image whose alt text is the name.
    let photo = card.photo;
    if (!photo) {
      for (let i = 0; i < end; i++) {
        const e = events[i]!;
        if (e.type === "img" && isProfilePhoto(e.src) && e.alt.replace(/[’']s Profile Picture$/i, "") === card.name) {
          photo = e.src;
          break;
        }
      }
    }

    // The headline is the first plain text (not a link, not a button) after the name.
    let headline: string | null = null;
    for (let j = card.nameAt + 1; j < stopAt; j++) {
      const e = events[j]!;
      if (e.type === "text" && e.anchors.length === 0 && !BUTTON_TEXT.test(e.text) && !MUTUAL.test(e.text)) {
        headline = e.text;
        break;
      }
    }

    return {
      name: card.name!,
      headline,
      headlineTruncated: headline !== null && /(…|\.\.\.)$/.test(headline),
      companyHint: companyHintFromHeadline(headline),
      profileUrl: card.url,
      profileKey: card.key,
      photoUrl: photo,
    };
  });
}
