import type { ReactNode } from "react";
import { requireAuthed } from "@/lib/auth";
import { loadCounts } from "@/lib/data";
import { NavLinks } from "@/components/NavLinks";
import { signOut } from "../actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase } = await requireAuthed();
  const counts = await loadCounts(supabase);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">Outreach Tracker</span>
          <form action={signOut}>
            <button type="submit" className="btn ghost small">Sign out</button>
          </form>
        </div>
        <NavLinks counts={counts} />
      </header>
      <main className="container stack">{children}</main>
    </>
  );
}
