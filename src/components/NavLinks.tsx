"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Accepted", count: "accepted" as const },
  { href: "/pending", label: "Pending", count: "pending" as const },
  { href: "/unmatched", label: "Unknown accepts", count: "unmatched" as const },
  { href: "/messaged", label: "Messaged", count: "followUps" as const, hint: "follow-ups due" },
  { href: "/jobs", label: "Jobs", count: "jobsNew" as const, hint: "new jobs" },
  { href: "/log", label: "Log request" },
  { href: "/templates", label: "Templates" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks({ counts }: { counts: { accepted: number; pending: number; unmatched: number; followUps: number; jobsNew: number } }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        const n = "count" in link && link.count ? counts[link.count] : 0;
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
            {link.label}
            {n > 0 && (
              <span className="count" title={"hint" in link ? `${n} ${link.hint}` : undefined}>
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
