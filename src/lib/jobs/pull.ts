import { classifyRole } from "./classify";
import { upsertArgs, type JobOutcome } from "./save";
import { fetchSource, mapJobs, sourceName, type FetchDeps, type SourceKind } from "./sources";

export interface SourceRow {
  id: string;
  kind: SourceKind;
  slug: string;
  label: string | null;
}

export interface PullStore {
  /** Enabled sources only. */
  listSources(): Promise<SourceRow[]>;
  upsertJob(args: Record<string, unknown>): Promise<JobOutcome>;
  recordPull(id: string, result: { status: string; listed: number | null; added: number | null }, at: Date): Promise<void>;
}

export interface PullResult {
  id: string;
  kind: SourceKind;
  slug: string;
  ok: boolean;
  /** "ok", or why it failed. */
  status: string;
  /** Jobs the board listed. */
  listed: number;
  /** Of those, the ones in your role families. */
  relevant: number;
  /** Relevant jobs new to you (not seen before, here or on another source). */
  added: number;
}

/** Most relevant jobs kept from one board in one pull. */
export const MAX_RELEVANT_PER_SOURCE = 500;

export interface PullDeps extends FetchDeps {
  now?: () => Date;
}

/**
 * Pulls one board. Only jobs that classify into one of your role families are kept: a company's
 * board lists everything from sales to legal, and the feed should stay about the roles you want.
 * Never throws: a failing board is recorded on its row and reported.
 */
export async function pullSource(source: SourceRow, store: PullStore, deps: PullDeps = {}): Promise<PullResult> {
  const now = deps.now?.() ?? new Date();
  const base = { id: source.id, kind: source.kind, slug: source.slug };
  try {
    const json = await fetchSource(source.kind, source.slug, deps);
    const all = mapJobs(source.kind, json, source.label);
    const relevant = all.filter((j) => classifyRole(j.title) !== "other").slice(0, MAX_RELEVANT_PER_SOURCE);

    let added = 0;
    for (const job of relevant) {
      const outcome = await store.upsertJob(upsertArgs({ ...job, source: sourceName(source.kind, source.slug) }, now, null));
      if (outcome === "inserted") added++;
    }
    await store.recordPull(source.id, { status: "ok", listed: all.length, added }, now);
    return { ...base, ok: true, status: "ok", listed: all.length, relevant: relevant.length, added };
  } catch (e) {
    const status = (e as Error).message.slice(0, 200);
    await store.recordPull(source.id, { status, listed: null, added: null }, now).catch(() => {});
    return { ...base, ok: false, status, listed: 0, relevant: 0, added: 0 };
  }
}

/** Pulls every enabled source, a few at a time. One failing board never stops the rest. */
export async function pullAll(store: PullStore, deps: PullDeps = {}, concurrency = 3): Promise<PullResult[]> {
  const sources = await store.listSources();
  const results: PullResult[] = new Array(sources.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < sources.length; i = next++) results[i] = await pullSource(sources[i]!, store, deps);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return results;
}
