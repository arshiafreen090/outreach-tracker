import { describe, expect, it, vi } from "vitest";
import { handlePull } from "@/lib/jobs/handler";
import { pullAll, pullSource, type PullStore, type SourceRow } from "@/lib/jobs/pull";
import { fromLinkedIn, upsertArgs, type JobOutcome } from "@/lib/jobs/save";
import { fetchSource, MAX_RESPONSE_BYTES, mapJobs, sourceName, sourceUrl } from "@/lib/jobs/sources";

// Shapes follow the vendors' own docs (Greenhouse Job Board API, Lever Postings API, Ashby posting API).
const greenhouse = {
  jobs: [
    { id: 4012345, internal_job_id: 99, title: "Data Analyst Intern", updated_at: "2026-10-10T10:00:00-04:00", requisition_id: "R1", location: { name: "Bengaluru, India" }, absolute_url: "https://boards.greenhouse.io/acme/jobs/4012345", metadata: null },
    { id: 4012346, title: "Account Executive", location: { name: "Remote" }, absolute_url: "https://boards.greenhouse.io/acme/jobs/4012346" },
    { id: 4012347, title: "Software Engineer, Backend", location: { name: "Pune" }, absolute_url: "https://boards.greenhouse.io/acme/jobs/4012347" },
    { id: 4012348, title: "   ", location: { name: "x" }, absolute_url: "https://boards.greenhouse.io/acme/jobs/4012348" },
    { id: 4012349, title: "No link" },
    "garbage",
  ],
  meta: { total: 6 },
};
const lever = [
  { id: "5ac21346-8e0c-4494-8e7a-3eb92ff77902", text: "Machine Learning Intern", hostedUrl: "https://jobs.lever.co/acme/5ac21346", applyUrl: "https://jobs.lever.co/acme/5ac21346/apply", categories: { location: "Pune", commitment: "Intern", team: "AI", department: "Eng", allLocations: ["Pune"] }, workplaceType: "hybrid", country: "IN" },
  { id: "b1", text: "Sales Lead", hostedUrl: "https://jobs.lever.co/acme/b1", categories: { location: "Delhi" }, workplaceType: "unspecified" },
  { id: "b2", text: "Missing link" },
  null,
];
const ashby = {
  apiVersion: "1",
  jobs: [
    { title: "Product Analyst", location: "Bengaluru", department: "Product", team: "Growth", isRemote: false, workplaceType: "Hybrid", employmentType: "FullTime", publishedAt: "2026-10-09T08:00:00.000+00:00", jobUrl: "https://jobs.ashbyhq.com/acme/abc", applyUrl: "https://jobs.ashbyhq.com/acme/abc/application", isListed: true },
    { title: "Hidden Data Scientist", location: "Pune", jobUrl: "https://jobs.ashbyhq.com/acme/hidden", isListed: false },
    { title: "AI Engineer Intern", location: "Remote", isRemote: true, employmentType: "Intern", jobUrl: "https://jobs.ashbyhq.com/acme/ai" },
  ],
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe("sourceUrl", () => {
  it("only ever builds the three documented hosts", () => {
    expect(sourceUrl("greenhouse", "acme")).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs");
    expect(sourceUrl("lever", "acme")).toBe("https://api.lever.co/v0/postings/acme?mode=json");
    expect(sourceUrl("ashby", "Acme.Inc")).toBe("https://api.ashbyhq.com/posting-api/job-board/Acme.Inc");
  });
  it.each(["../etc/passwd", "a/b", "a b", "", "-x", "a?b=1", "a#b", "x".repeat(101), "https://evil.example"])("refuses the board name %j", (slug) => {
    expect(() => sourceUrl("greenhouse", slug)).toThrow(/Invalid board name/);
  });
  it("names sources consistently", () => {
    expect(sourceName("greenhouse", "AcMe")).toBe("greenhouse:acme");
  });
});

describe("mapJobs", () => {
  it("Greenhouse: id, title, location and link; skips entries missing any", () => {
    const jobs = mapJobs("greenhouse", greenhouse, "Acme");
    expect(jobs.map((j) => j.externalId)).toEqual(["4012345", "4012346", "4012347"]);
    expect(jobs[0]).toMatchObject({ title: "Data Analyst Intern", company: "Acme", location: "Bengaluru, India", url: "https://boards.greenhouse.io/acme/jobs/4012345", workMode: null });
  });
  it("Lever: reads the work mode and the commitment (used for internships), skips entries missing a link", () => {
    const jobs = mapJobs("lever", lever, "Acme");
    expect(jobs.map((j) => j.externalId)).toEqual(["5ac21346-8e0c-4494-8e7a-3eb92ff77902", "b1"]);
    expect(jobs[0]).toMatchObject({ title: "Machine Learning Intern", location: "Pune", workMode: "Hybrid", employmentType: "Intern" });
    expect(jobs[1]!.workMode).toBeNull(); // "unspecified" is not a work mode
  });
  it("Ashby: uses the page URL as the id, honours isListed, falls back to isRemote", () => {
    const jobs = mapJobs("ashby", ashby, null);
    expect(jobs.map((j) => j.title)).toEqual(["Product Analyst", "AI Engineer Intern"]);
    expect(jobs[0]).toMatchObject({ externalId: "https://jobs.ashbyhq.com/acme/abc", workMode: "Hybrid", employmentType: "FullTime", postedAt: "2026-10-09T08:00:00.000+00:00", company: null });
    expect(jobs[1]).toMatchObject({ workMode: "Remote", employmentType: "Intern" });
  });
  it.each([
    ["greenhouse", { nope: 1 }],
    ["greenhouse", []],
    ["lever", { jobs: [] }],
    ["ashby", "text"],
    ["ashby", null],
  ] as const)("%s: refuses an unexpected response shape %j", (kind, body) => {
    expect(() => mapJobs(kind, body, null)).toThrow(/Unexpected response/);
  });
  it("returns an empty list for a board with no openings", () => {
    expect(mapJobs("greenhouse", { jobs: [], meta: { total: 0 } }, "x")).toEqual([]);
    expect(mapJobs("lever", [], "x")).toEqual([]);
  });
});

describe("fetchSource", () => {
  it("calls the documented URL with no redirects, a timeout and a JSON Accept header", async () => {
    const f = vi.fn(async () => jsonResponse(greenhouse));
    expect(await fetchSource("greenhouse", "acme", { fetchImpl: f as unknown as typeof fetch })).toEqual(greenhouse);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs");
    expect(init).toMatchObject({ redirect: "error", headers: { Accept: "application/json" } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    [new Response("", { status: 404 }), /No such board/],
    [new Response("", { status: 500 }), /HTTP 500/],
    [new Response("<html>", { status: 200 }), /did not return JSON/],
    [new Response("x".repeat(MAX_RESPONSE_BYTES + 1), { status: 200 }), /too large/],
    [new Response("{}", { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }), /too large/],
  ])("turns %# into a short message", async (res, message) => {
    await expect(fetchSource("lever", "acme", { fetchImpl: (async () => res) as unknown as typeof fetch })).rejects.toThrow(message);
  });
  it("reports network failures and timeouts without leaking details", async () => {
    await expect(fetchSource("lever", "acme", { fetchImpl: (async () => { throw new Error("ECONNREFUSED 10.0.0.5"); }) as unknown as typeof fetch })).rejects.toThrow(/^Could not reach the job board\.$/);
    const timeout = Object.assign(new Error("slow"), { name: "TimeoutError" });
    await expect(fetchSource("lever", "acme", { fetchImpl: (async () => { throw timeout; }) as unknown as typeof fetch })).rejects.toThrow(/^Timed out\.$/);
  });
});

// ---------------------------------------------------------------- pulling

function fakeStore(over: Partial<PullStore> & { sources?: SourceRow[]; outcomes?: JobOutcome[] } = {}) {
  const upserts: Record<string, unknown>[] = [];
  const pulls: { id: string; status: string; listed: number | null; added: number | null }[] = [];
  const outcomes = [...(over.outcomes ?? [])];
  const store: PullStore = {
    listSources: over.listSources ?? (async () => over.sources ?? []),
    upsertJob: over.upsertJob ?? (async (args) => {
      upserts.push(args);
      return outcomes.shift() ?? "inserted";
    }),
    recordPull: over.recordPull ?? (async (id, r) => void pulls.push({ id, ...r })),
  };
  return { store, upserts, pulls };
}
const src = (over: Partial<SourceRow> = {}): SourceRow => ({ id: "s1", kind: "greenhouse", slug: "acme", label: "Acme", ...over });
const NOW = new Date("2026-10-16T12:00:00Z");
const respond = (body: unknown) => ({ fetchImpl: (async () => jsonResponse(body)) as unknown as typeof fetch, now: () => NOW });

describe("pullSource", () => {
  it("keeps only jobs in your role families and saves them under the source's name", async () => {
    const { store, upserts, pulls } = fakeStore({ outcomes: ["inserted", "duplicate"] });
    const result = await pullSource(src(), store, respond(greenhouse));
    expect(result).toMatchObject({ ok: true, status: "ok", listed: 3, relevant: 2, added: 1 }); // Account Executive filtered out
    expect(upserts.map((a) => a.p_title)).toEqual(["Data Analyst Intern", "Software Engineer, Backend"]);
    expect(upserts[0]).toMatchObject({
      p_source: "greenhouse:acme",
      p_external_id: "4012345",
      p_company: "Acme",
      p_role_family: "data_analytics",
      p_is_internship: true,
      p_found_at: NOW.toISOString(),
      p_ingest_id: null,
      p_soft_key: "acme|data analyst intern|bengaluru",
    });
    expect(pulls).toEqual([{ id: "s1", status: "ok", listed: 3, added: 1 }]);
  });

  it("flags internships from the ATS's own employment type, not only the title", async () => {
    const { store, upserts } = fakeStore();
    await pullSource(src({ kind: "ashby", slug: "acme" }), store, respond({ jobs: [{ title: "Data Analyst", jobUrl: "https://jobs.ashbyhq.com/a/1", employmentType: "Intern" }] }));
    expect(upserts[0]).toMatchObject({ p_is_internship: true });
  });

  it("records a failure on the source and returns it instead of throwing", async () => {
    const { store, pulls } = fakeStore();
    const result = await pullSource(src(), store, { fetchImpl: (async () => new Response("", { status: 404 })) as unknown as typeof fetch, now: () => NOW });
    expect(result).toMatchObject({ ok: false, status: "No such board. Check the name.", listed: 0, added: 0 });
    expect(pulls).toEqual([{ id: "s1", status: "No such board. Check the name.", listed: null, added: null }]);
  });

  it("survives the database failing while saving", async () => {
    const { store } = fakeStore({ upsertJob: async () => { throw new Error("db down"); }, recordPull: async () => { throw new Error("db down"); } });
    const result = await pullSource(src(), store, respond(greenhouse));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("db down");
  });

  it("reports an empty board as a success with nothing new", async () => {
    const { store, pulls } = fakeStore();
    expect(await pullSource(src(), store, respond({ jobs: [], meta: { total: 0 } }))).toMatchObject({ ok: true, listed: 0, relevant: 0, added: 0 });
    expect(pulls[0]).toMatchObject({ status: "ok", listed: 0, added: 0 });
  });
});

describe("pullAll", () => {
  it("pulls every source, one failure never stops the rest, and results keep the source order", async () => {
    const sources = [src({ id: "a", slug: "good-1" }), src({ id: "b", slug: "bad" }), src({ id: "c", slug: "good-2" })];
    const { store, pulls } = fakeStore({ sources });
    const fetchImpl = (async (url: string) => (url.includes("/bad/") ? new Response("", { status: 500 }) : jsonResponse(greenhouse))) as unknown as typeof fetch;
    const results = await pullAll(store, { fetchImpl, now: () => NOW });
    expect(results.map((r) => [r.id, r.ok])).toEqual([["a", true], ["b", false], ["c", true]]);
    expect(pulls.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("never runs more than the concurrency limit at once", async () => {
    const sources = Array.from({ length: 8 }, (_, i) => src({ id: `s${i}`, slug: `board-${i}` }));
    const { store } = fakeStore({ sources });
    let running = 0;
    let peak = 0;
    const fetchImpl = (async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return jsonResponse({ jobs: [] });
    }) as unknown as typeof fetch;
    await pullAll(store, { fetchImpl, now: () => NOW }, 3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("does nothing, quietly, when there are no sources", async () => {
    expect(await pullAll(fakeStore().store)).toEqual([]);
  });
});

describe("handlePull", () => {
  const SECRET = "p".repeat(40);
  const req = (headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) => new Request("http://x/api/jobs/pull", { method: "POST", headers });

  it("refuses without the secret and never pulls", async () => {
    const pull = vi.fn(async () => []);
    expect((await handlePull(req({}), { secret: SECRET, pull })).status).toBe(401);
    expect((await handlePull(req(), { secret: undefined, pull })).status).toBe(401);
    expect(pull).not.toHaveBeenCalled();
  });
  it("summarises the pull", async () => {
    const results = [
      { id: "a", kind: "lever" as const, slug: "x", ok: true, status: "ok", listed: 10, relevant: 4, added: 3 },
      { id: "b", kind: "ashby" as const, slug: "y", ok: false, status: "Timed out.", listed: 0, relevant: 0, added: 0 },
    ];
    const res = await handlePull(req(), { secret: SECRET, pull: async () => results });
    expect(await res.json()).toMatchObject({ ok: true, sources: 2, failed: 1, added: 3 });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("hides errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handlePull(req(), { secret: SECRET, pull: async () => { throw new Error("password=hunter2"); } });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/hunter2/);
    spy.mockRestore();
  });
});

describe("upsertArgs", () => {
  const job = fromLinkedIn({ id: "4471486393", title: "Lead Advanced Analytics, Community Support", company: "Airbnb", location: "Bengaluru", workMode: "Hybrid", url: "https://www.linkedin.com/jobs/view/4471486393/", alertTitle: "Data Analyst", badges: [] });

  it("turns a LinkedIn alert job into the database call, classified and de-duplicable", () => {
    expect(upsertArgs(job, NOW, "ingest-1")).toEqual({
      p_source: "linkedin-alert",
      p_external_id: "4471486393",
      p_title: "Lead Advanced Analytics, Community Support",
      p_company: "Airbnb",
      p_location: "Bengaluru",
      p_work_mode: "Hybrid",
      p_url: "https://www.linkedin.com/jobs/view/4471486393/",
      p_saved_search: "Data Analyst",
      p_role_family: "data_analytics",
      p_is_internship: false,
      p_soft_key: "airbnb|lead advanced analytics community support|bengaluru",
      p_posted_at: null,
      p_found_at: NOW.toISOString(),
      p_ingest_id: "ingest-1",
    });
  });
  it("drops a link that isn't plain http(s) and clips absurdly long text", () => {
    const args = upsertArgs({ ...job, url: "javascript:alert(1)", title: "A".repeat(500), company: "C".repeat(500) }, NOW, null);
    expect(args.p_url).toBeNull();
    expect((args.p_title as string).length).toBe(300);
    expect((args.p_company as string).length).toBe(200);
  });
  it("copes with every optional field missing", () => {
    const args = upsertArgs({ source: "x", externalId: "1", title: "Data Analyst", company: null, location: null, workMode: null, url: null, savedSearch: null }, NOW, null);
    expect(args).toMatchObject({ p_company: null, p_location: null, p_work_mode: null, p_url: null, p_soft_key: null, p_posted_at: null });
  });
});
