import { describe, expect, it } from "vitest";
import { filtersToQuery, isJobStatus, JOB_STATUSES, MAX_SEARCH, parseJobFilters, safeSearch, sourceLabel } from "@/lib/jobs/filters";
import { boardNameFromInput, SLUG, sourceUrl } from "@/lib/jobs/sources";

describe("safeSearch", () => {
  it("keeps plain text, including letters from any language and common job-title symbols", () => {
    expect(safeSearch("Data Analyst")).toBe("Data Analyst");
    expect(safeSearch("C++ & C# dev")).toBe("C++ & C# dev");
    expect(safeSearch("Dexter's Tech")).toBe("Dexter's Tech");
    expect(safeSearch("Zürich Entwickler 日本")).toBe("Zürich Entwickler 日本");
    expect(safeSearch("full-stack")).toBe("full-stack");
  });
  it.each([
    ["data, analyst", "data analyst"],
    ["a),title.eq.x,(b", "a title eq x b"],
    ["title.ilike.%x%", "title ilike x"],
    ["select * from people", "select from people"],
    ["\\; drop table jobs; --", "drop table jobs --"],
    ['"quoted"', "quoted"],
    ["  spaced   out  ", "spaced out"],
  ])("neutralises PostgREST filter syntax in %j", (raw, expected) => {
    expect(safeSearch(raw)).toBe(expected);
    expect(safeSearch(raw)).not.toMatch(/[,()%*.\\"]/);
  });
  it("handles empty input and caps the length", () => {
    expect(safeSearch(undefined)).toBe("");
    expect(safeSearch(null)).toBe("");
    expect(safeSearch("   ")).toBe("");
    expect(safeSearch("x".repeat(500))).toHaveLength(MAX_SEARCH);
  });
});

describe("parseJobFilters", () => {
  it("defaults to new jobs in every role", () => {
    expect(parseJobFilters({})).toEqual({ status: "new", family: "all", internshipsOnly: false, q: "" });
  });
  it("reads each filter", () => {
    expect(parseJobFilters({ status: "applied", family: "ml", internships: "1", q: "Zepto" })).toEqual({ status: "applied", family: "ml", internshipsOnly: true, q: "Zepto" });
    expect(parseJobFilters({ status: "all", family: "other", internships: "on" })).toMatchObject({ status: "all", family: "other", internshipsOnly: true });
  });
  it("falls back instead of failing on junk, and uses the first of repeated values", () => {
    expect(parseJobFilters({ status: "bogus", family: "wizard", internships: "maybe" })).toEqual({ status: "new", family: "all", internshipsOnly: false, q: "" });
    expect(parseJobFilters({ status: ["seen", "applied"], family: ["ai", "swe"] })).toMatchObject({ status: "seen", family: "ai" });
    expect(parseJobFilters({ q: ["a,b", "c"] }).q).toBe("a b");
  });
});

describe("filtersToQuery", () => {
  it("omits defaults so links stay short, and round-trips", () => {
    expect(filtersToQuery(parseJobFilters({}))).toBe("");
    const f = parseJobFilters({ status: "seen", family: "data_science", internships: "1", q: "Acme Corp" });
    const qs = filtersToQuery(f);
    expect(qs).toBe("?status=seen&family=data_science&internships=1&q=Acme+Corp");
    expect(parseJobFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual(f);
  });
});

describe("statuses and labels", () => {
  it("knows the four statuses", () => {
    expect(JOB_STATUSES).toEqual(["new", "seen", "applied", "dismissed"]);
    expect(isJobStatus("applied")).toBe(true);
    for (const bad of ["maybe", "", null, undefined, "NEW"]) expect(isJobStatus(bad)).toBe(false);
  });
  it("makes sources readable", () => {
    expect(sourceLabel("linkedin-alert")).toBe("LinkedIn alert");
    expect(sourceLabel("greenhouse:acme")).toBe("Greenhouse (acme)");
    expect(sourceLabel("ashby:a:b")).toBe("Ashby (a:b)");
    expect(sourceLabel("naukri")).toBe("Naukri");
  });
});

describe("boardNameFromInput", () => {
  it.each([
    ["acme", "acme"],
    ["  acme  ", "acme"],
    ["https://boards.greenhouse.io/acme", "acme"],
    ["boards.greenhouse.io/acme/jobs/123", "acme"],
    ["jobs.lever.co/acme/5ac21346-8e0c", "acme"],
    ["https://jobs.ashbyhq.com/Acme?utm=x#top", "Acme"],
    ["https://example.com/", ""],
  ])("%s -> %j", (input, expected) => expect(boardNameFromInput(input)).toBe(expected));

  it("can only ever produce a URL on a vendor's fixed host, with no path escape", () => {
    const hosts = new Set(["boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com"]);
    const hostile = ["../../etc/passwd", "a/../b", "https://x.com/..%2f..", "acme?x=1", "a b", "", "https://evil.example/x", "@evil.example", "a@evil.example", "evil.example:80", "a\\b", "%2e%2e", "a#frag"];
    for (const input of hostile) {
      for (const kind of ["greenhouse", "lever", "ashby"] as const) {
        let built: string | null = null;
        try {
          built = sourceUrl(kind, boardNameFromInput(input));
        } catch {
          // refused: also safe
        }
        if (built) {
          const u = new URL(built);
          expect(hosts.has(u.hostname), `${kind} ${JSON.stringify(input)} -> ${built}`).toBe(true);
          expect(u.pathname.includes(".."), built).toBe(false);
          expect(u.username + u.password, built).toBe("");
        }
      }
    }
  });
  it("rejects names that don't match the strict pattern", () => {
    for (const bad of ["a b", "a?x=1", "a/b", "", "-x", "../x"]) expect(SLUG.test(bad), bad).toBe(false);
  });
});
