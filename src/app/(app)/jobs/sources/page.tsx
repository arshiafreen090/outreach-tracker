import Link from "next/link";
import { JobSourcesPanel } from "@/components/JobSourcesPanel";
import { requireAuthed } from "@/lib/auth";
import { loadJobSources } from "@/lib/data";
import { addJobSource, pullAllJobSources, pullJobSource, removeJobSource, setJobSourceEnabled } from "../../../actions";

export const metadata = { title: "Job boards · Outreach Tracker" };

export default async function JobSourcesPage() {
  const { supabase } = await requireAuthed();
  const sources = await loadJobSources(supabase);

  return (
    <>
      <div className="page-head">
        <h1>Company job boards</h1>
        <Link href="/jobs">← Jobs</Link>
      </div>
      <p className="muted">
        Many companies publish their openings through Greenhouse, Lever or Ashby, which offer a public listing anyone may read. Add the ones you care about: they are checked once a day and only roles in your families (data analytics, product analytics, data science, ML, AI, software engineering) are kept. Nothing here touches LinkedIn.
      </p>
      <JobSourcesPanel
        sources={sources}
        add={addJobSource}
        pull={pullJobSource}
        pullAll={pullAllJobSources}
        setEnabled={setJobSourceEnabled}
        remove={removeJobSource}
      />
    </>
  );
}
