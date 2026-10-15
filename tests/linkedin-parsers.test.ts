import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { companyHintFromHeadline, isProfilePhoto, parseAccepters } from "@/lib/ingest/linkedin/accept";
import { classifyLinkedIn } from "@/lib/ingest/linkedin/classify";
import { parseJobAlert, splitCompanyLine } from "@/lib/ingest/linkedin/jobs";
import { processEmail, type ProcessInput } from "@/lib/ingest/linkedin/process";
import { parseRawEmail } from "@/lib/ingest/mime";
import { parseProfileUrl } from "@/lib/urls";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests", "fixtures", "linkedin", name), "utf8");

const GOOD_AUTH =
  "mx.google.com; dkim=pass header.i=@maila.linkedin.com header.s=d2048; dkim=pass header.i=@linkedin.com header.s=d2048; spf=pass; dmarc=pass (p=reject) header.from=linkedin.com";

const input = (over: Partial<ProcessInput> = {}): ProcessInput => ({
  fromAddress: "invitations@linkedin.com",
  subject: "Test accepted your invitation",
  html: fixture("accept-single.html"),
  text: null,
  authenticationResults: GOOD_AUTH,
  linkedinClass: "INVITE-ACCEPT",
  linkedinTemplate: "email_accept_invite_single_01",
  ...over,
});

describe("parseProfileUrl with LinkedIn's email tracking path", () => {
  it("reads /comm/in/<slug> and country subdomains", () => {
    expect(parseProfileUrl("https://in.linkedin.com/comm/in/test-person-1a2b3c?lipi=x&trk=y")).toEqual({
      url: "https://www.linkedin.com/in/test-person-1a2b3c/",
      key: "in/test-person-1a2b3c",
    });
    expect(parseProfileUrl("https://www.linkedin.com/comm/in/AbC")?.key).toBe("in/abc");
  });
  it("still refuses other comm paths", () => {
    for (const u of ["https://www.linkedin.com/comm/messaging/compose/ABC", "https://www.linkedin.com/comm/jobs/view/123456/", "https://www.linkedin.com/comm/feed/"]) {
      expect(parseProfileUrl(u)).toBeNull();
    }
  });
});

describe("parseAccepters: single accepted-invitation email", () => {
  const people = parseAccepters(fixture("accept-single.html"));

  it("finds exactly the accepter and ignores 'people you may know'", () => {
    expect(people).toHaveLength(1);
    const p = people[0]!;
    expect(p.name).toBe("Test Person");
    expect(p.profileUrl).toBe("https://www.linkedin.com/in/test-person-1a2b3c/");
    expect(p.profileKey).toBe("in/test-person-1a2b3c");
    expect(people.map((x) => x.profileKey)).not.toContain("in/other-one-123");
  });
  it("reads the headline, a company hint and the photo", () => {
    const p = people[0]!;
    expect(p.headline).toBe("Software Engineer @Acme Corp | React | Node");
    expect(p.headlineTruncated).toBe(false);
    expect(p.companyHint).toBe("Acme Corp");
    expect(p.photoUrl).toBe("https://media.licdn.com/dms/image/v2/AAA/profile-displayphoto-scale_400_400/B/0/1?e=1&v=beta&t=tok");
  });
});

describe("parseAccepters: digest email with several people", () => {
  const people = parseAccepters(fixture("accept-digest.html"));

  it("returns everyone, in order", () => {
    expect(people.map((p) => p.name)).toEqual(["Alpha Tester", "Gamma Person"]);
    expect(people.map((p) => p.profileKey)).toEqual(["in/alpha-tester", "in/gamma-person"]);
  });
  it("matches photos by alt text when they are not inside the profile link", () => {
    expect(people[0]!.photoUrl).toContain("/DDD/profile-displayphoto-shrink");
    expect(people[1]!.photoUrl).toContain("/EEE/profile-displayphoto-scale");
  });
  it("takes the next plain text as the headline, never a button", () => {
    expect(people[0]!.headline).toBe("Founding team at Beta Labs");
    expect(people[0]!.companyHint).toBe("Beta Labs");
    expect(people[1]!.headline).toBeNull();
    expect(people[1]!.companyHint).toBeNull();
  });
});

describe("parseAccepters: edge cases", () => {
  it("returns nothing for an email with no profile links", () => {
    expect(parseAccepters("<html><body><p>Hello</p></body></html>")).toEqual([]);
    expect(parseAccepters("")).toEqual([]);
  });
  it("flags a headline LinkedIn cut off", () => {
    const html = `<a href="https://www.linkedin.com/comm/in/a-b"> A B </a><table><tr><td>Software Developer @FirstClub • 4+ Year FTE Experience…</td></tr></table>`;
    const [p] = parseAccepters(html);
    expect(p!.headlineTruncated).toBe(true);
    expect(p!.companyHint).toBe("FirstClub");
  });
  it("does not choke on hostile markup", () => {
    const html = `<a href="javascript:alert(1)">x</a><a href="https://www.linkedin.com/in/ok-slug"><script>alert(1)</script>Name</a><img src="data:text/html,x">`;
    const people = parseAccepters(html);
    expect(people.map((p) => p.profileKey)).toEqual(["in/ok-slug"]);
    expect(people[0]!.photoUrl).toBeNull();
  });
});

describe("isProfilePhoto", () => {
  it.each([
    ["https://media.licdn.com/dms/image/v2/A/profile-displayphoto-scale_400_400/B/0/1?e=1", true],
    ["https://media.licdn.com/dms/image/v2/A/profile-displayphoto-shrink_400_400/x", true],
    ["https://media.licdn.com/dms/image/v2/A/company-logo_100_100/x", false],
    ["https://static.licdn.com/aero-v1/sc/h/icon", false],
    ["http://media.licdn.com/dms/image/v2/A/profile-displayphoto-scale_400_400/x", false],
    ["https://evil.example.com/profile-displayphoto-scale_400_400/x", false],
    ["https://licdn.com.evil.com/profile-displayphoto/x", false],
    ["not a url", false],
  ])("%s -> %s", (src, expected) => expect(isProfilePhoto(src)).toBe(expected));
});

describe("companyHintFromHeadline", () => {
  it.each([
    ["Building Tech@FirstClub | Reactjs | React Native", "FirstClub"],
    ["Software Developer @FirstClub • 4+ Year FTE Experience…", "FirstClub"],
    ["Director @VERDEX || Managing Director…", "VERDEX"],
    ["SDE-IV – AI Delivery @ The Standard…", "The Standard"],
    ["Founding team at Cardboard", "Cardboard"],
    ["Aspiring Data Scientist at Google | ML", "Google"],
    ["Full-stack Engineer @ Acme, Inc. (Remote)", "Acme"],
    ["Looking at new opportunities", null],
    ["Seeking Full-Time SDE Role | React…", null],
    ["", null],
    [null, null],
  ])("%j -> %j", (headline, expected) => expect(companyHintFromHeadline(headline)).toBe(expected));
});

describe("parseJobAlert", () => {
  const jobs = parseJobAlert(fixture("job-alert.html"));

  it("lists each job once, with its numeric id and a clean URL", () => {
    expect(jobs.map((j) => j.id)).toEqual(["4471486393", "4476265857", "4477672701"]);
    expect(jobs[0]!.url).toBe("https://www.linkedin.com/jobs/view/4471486393/");
  });
  it("splits title, company, location and work mode", () => {
    expect(jobs[0]).toMatchObject({ title: "Senior Data Analyst, Support", company: "Acme", location: "Bengaluru", workMode: "Hybrid", badges: ["5 school alumni"] });
    expect(jobs[1]).toMatchObject({ title: "Analyst - II", company: "Foo.com Pvt. Ltd.", location: "Mumbai, Maharashtra", workMode: "On-site", badges: ["Actively recruiting", "Easy Apply"] });
    expect(jobs[2]).toMatchObject({ title: "Machine Learning Intern", company: "Dexter's Tech", location: "India", workMode: "Remote" });
  });
  it("records which saved search each job came from", () => {
    expect(jobs.map((j) => j.alertTitle)).toEqual(["Data Analyst", "Data Analyst", "ml intern jobs in Pune"]);
  });
  it("returns nothing for an email without jobs", () => {
    expect(parseJobAlert("<p>nothing here</p>")).toEqual([]);
  });
});

describe("splitCompanyLine", () => {
  it.each([
    ["Airbnb · Bengaluru (Hybrid)", { company: "Airbnb", location: "Bengaluru", workMode: "Hybrid" }],
    ["Dexter's Tech · India (Remote)", { company: "Dexter's Tech", location: "India", workMode: "Remote" }],
    ["Acme · Pune", { company: "Acme", location: "Pune", workMode: null }],
    ["Acme", { company: "Acme", location: null, workMode: null }],
  ])("%s", (line, expected) => expect(splitCompanyLine(line)).toEqual(expected));
});

describe("classifyLinkedIn", () => {
  const base = { fromAddress: "invitations@linkedin.com", authenticationResults: GOOD_AUTH, linkedinClass: "INVITE-ACCEPT", linkedinTemplate: "email_accept_invite_single_01", subject: "x" };

  it("trusts verified LinkedIn mail and maps LinkedIn's own labels to a kind", () => {
    expect(classifyLinkedIn(base)).toEqual({ trusted: true, untrustedReason: null, kind: "accept" });
    expect(classifyLinkedIn({ ...base, linkedinClass: "INVITE-ACCEPT", linkedinTemplate: "email_accept_invite_digest_02" }).kind).toBe("accept");
    expect(classifyLinkedIn({ ...base, fromAddress: "jobalerts-noreply@linkedin.com", linkedinClass: "SAVEDSEARCH", linkedinTemplate: "email_job_alert_digest_01" }).kind).toBe("job_alert");
    expect(classifyLinkedIn({ ...base, linkedinClass: "MSG_NEW", linkedinTemplate: "email_message_new" }).kind).toBe("message");
    expect(classifyLinkedIn({ ...base, linkedinClass: "WHO-VIEWED", linkedinTemplate: "email_views_01" }).kind).toBe("other");
  });
  it("falls back to the subject when the labels are missing", () => {
    expect(classifyLinkedIn({ ...base, linkedinClass: null, linkedinTemplate: null, subject: "Sam accepted your invitation" }).kind).toBe("accept");
    expect(classifyLinkedIn({ ...base, linkedinClass: null, linkedinTemplate: null, subject: "Sam sent you something" }).kind).toBe("other");
  });
  it.each([
    ["a lookalike domain", { fromAddress: "invitations@linkedin.com.evil.com" }],
    ["a different domain", { fromAddress: "invitations@example.com" }],
    ["no sender", { fromAddress: null }],
    ["no authentication result", { authenticationResults: null }],
    ["a result that does not start with Gmail's", { authenticationResults: "evil.example; dkim=pass header.i=@linkedin.com" }],
    ["DKIM failing", { authenticationResults: "mx.google.com; dkim=fail header.i=@linkedin.com; spf=pass" }],
    ["DKIM passing for another domain", { authenticationResults: "mx.google.com; dkim=pass header.i=@evil-linkedin.com; spf=pass" }],
    ["DKIM passing only for a look-alike", { authenticationResults: "mx.google.com; dkim=pass header.i=@notlinkedin.com" }],
  ])("refuses %s, even with LinkedIn's labels", (_label, over) => {
    const c = classifyLinkedIn({ ...base, ...over });
    expect(c.trusted).toBe(false);
    expect(c.kind).toBe("other");
    expect(c.untrustedReason).toBeTruthy();
  });
});

describe("processEmail", () => {
  it("parses a single accept", () => {
    const r = processEmail(input());
    expect(r).toMatchObject({ kind: "accept", parse_status: "parsed", parse_error: null });
    expect(r.accepters.map((a) => a.profileKey)).toEqual(["in/test-person-1a2b3c"]);
    expect(r.result).toMatchObject({ linkedin: { class: "INVITE-ACCEPT", template: "email_accept_invite_single_01", trusted: true } });
  });
  it("parses a digest accept", () => {
    const r = processEmail(input({ html: fixture("accept-digest.html"), linkedinTemplate: "email_accept_invite_digest_02", fromAddress: "invitations@linkedin.com" }));
    expect(r.accepters).toHaveLength(2);
    expect(r.parse_status).toBe("parsed");
  });
  it("parses a job alert", () => {
    const r = processEmail(input({ html: fixture("job-alert.html"), fromAddress: "jobalerts-noreply@linkedin.com", linkedinClass: "SAVEDSEARCH", linkedinTemplate: "email_job_alert_digest_01" }));
    expect(r).toMatchObject({ kind: "job_alert", parse_status: "parsed" });
    expect(r.jobs).toHaveLength(3);
    expect(r.accepters).toEqual([]);
  });
  it("never acts on a forged sender, whatever the body says", () => {
    const r = processEmail(input({ fromAddress: "invitations@linkedin.com.evil.com" }));
    expect(r).toMatchObject({ kind: "other", parse_status: "ignored" });
    expect(r.accepters).toEqual([]);
    expect(r.parse_error).toMatch(/not a linkedin\.com address/);
  });
  it("marks an accept it can't read as failed, with the template name for debugging", () => {
    const r = processEmail(input({ html: "<p>redesigned email</p>", linkedinTemplate: "email_accept_invite_single_09" }));
    expect(r.parse_status).toBe("failed");
    expect(r.parse_error).toContain("email_accept_invite_single_09");
  });
  it("asks for a sample when a message email arrives", () => {
    const r = processEmail(input({ linkedinClass: "MSG_NEW", linkedinTemplate: "email_message_new_01" }));
    expect(r).toMatchObject({ kind: "message", parse_status: "failed" });
    expect(r.parse_error).toMatch(/send a sample/);
  });
  it("keeps but ignores other LinkedIn mail, recording its template", () => {
    const r = processEmail(input({ linkedinClass: "WHO-VIEWED", linkedinTemplate: "email_views_01" }));
    expect(r).toMatchObject({ kind: "other", parse_status: "ignored", parse_error: null });
    expect(r.result).toMatchObject({ linkedin: { template: "email_views_01" } });
  });
  it("copes with an email that has no HTML at all", () => {
    expect(processEmail(input({ html: null, text: "plain" })).parse_status).toBe("failed");
  });
});

// Runs only on your machine, where samples/ holds real emails (git-ignored). It asserts structure,
// not people, so the repo never contains anyone's name.
const samplesDir = path.join(process.cwd(), "samples");
const real = existsSync(samplesDir) ? readdirSync(samplesDir).filter((f) => f.endsWith(".eml")) : [];

describe.skipIf(real.length === 0)("your real sample emails (local only)", () => {
  const load = async (file: string) => {
    const mail = await parseRawEmail(readFileSync(path.join(samplesDir, file)).toString("base64url"));
    return { mail, out: processEmail({ ...mail, html: mail.html, text: mail.text }) };
  };

  it("every real LinkedIn email is verified as coming from LinkedIn", async () => {
    for (const file of real) {
      const { mail } = await load(file);
      expect(classifyLinkedIn(mail), file).toMatchObject({ trusted: true });
    }
  });

  it("accept emails yield people with a name, a /in/ profile key and a photo", async () => {
    let seen = 0;
    for (const file of real) {
      const { out } = await load(file);
      if (out.kind !== "accept") continue;
      seen++;
      expect(out.parse_status, file).toBe("parsed");
      expect(out.accepters.length, file).toBeGreaterThan(0);
      for (const a of out.accepters) {
        expect(a.name.length, file).toBeGreaterThan(1);
        expect(a.profileKey, file).toMatch(/^in\/[^/\s]+$/);
        expect(isProfilePhoto(a.photoUrl ?? ""), `${file}: ${a.profileKey}`).toBe(true);
        expect(a.headline, file).toBeTruthy();
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("job alerts yield several complete jobs", async () => {
    for (const file of real) {
      const { out } = await load(file);
      if (out.kind !== "job_alert") continue;
      expect(out.parse_status, file).toBe("parsed");
      expect(out.jobs.length, file).toBeGreaterThanOrEqual(3);
      for (const j of out.jobs) {
        expect(j.id, file).toMatch(/^\d{5,}$/);
        expect(j.title.length, file).toBeGreaterThan(2);
        expect(j.company, file).toBeTruthy();
      }
      expect(new Set(out.jobs.map((j) => j.id)).size, file).toBe(out.jobs.length);
    }
  });
});
