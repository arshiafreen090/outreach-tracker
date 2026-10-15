// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobCard } from "@/components/JobCard";
import { JobSourcesPanel } from "@/components/JobSourcesPanel";
import type { ActionResult, FormState } from "@/lib/action-types";
import type { JobRow, JobSourceRow } from "@/lib/db-types";

afterEach(cleanup);

const ok = async (): Promise<ActionResult> => ({ ok: true });
const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: "j1",
  title: "Machine Learning Intern",
  company_name: "Dexter's Tech",
  company_id: null,
  url: "https://www.linkedin.com/jobs/view/4477672701/",
  source: "linkedin-alert",
  posted_at: null,
  found_at: "2026-10-13T20:00:00Z",
  status: "new",
  location: "India",
  work_mode: "Remote",
  saved_search: "engineer intern jobs in Lucknow",
  role_family: "ml",
  is_internship: true,
  seen_in: ["linkedin-alert"],
  ...over,
});

describe("JobCard", () => {
  const setup = (over: Partial<JobRow> = {}) => {
    const setStatus = vi.fn(ok);
    render(<JobCard job={job(over)} setStatus={setStatus} />);
    return { user: userEvent.setup(), setStatus };
  };

  it("shows the title as a safe external link, with company, place and where it came from", () => {
    setup();
    const link = screen.getByRole("link", { name: /Machine Learning Intern/ });
    expect(link.getAttribute("href")).toBe("https://www.linkedin.com/jobs/view/4477672701/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Dexter's Tech · India · Remote")).toBeTruthy();
    expect(screen.getByText("Machine learning")).toBeTruthy();
    expect(screen.getByText("Internship")).toBeTruthy();
    expect(screen.getByText("Found 14 Oct")).toBeTruthy(); // 20:00 UTC is already the 14th in India
    expect(screen.getByText("Alert: engineer intern jobs in Lucknow")).toBeTruthy();
    expect(screen.getByText("LinkedIn alert")).toBeTruthy();
  });

  it("never links a javascript: or missing URL", () => {
    setup({ url: "javascript:alert(1)" });
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    setup({ url: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { name: "Machine Learning Intern" })).toBeTruthy();
  });

  it("flags a company you track and every source that listed it", () => {
    setup({ company_id: "c1", seen_in: ["linkedin-alert", "greenhouse:dexter"] });
    expect(screen.getByText("A company you track")).toBeTruthy();
    expect(screen.getByText("LinkedIn alert")).toBeTruthy();
    expect(screen.getByText("Greenhouse (dexter)")).toBeTruthy();
  });

  it("offers every status except the current one, and sends the one you press", async () => {
    const { user, setStatus } = setup();
    expect(screen.queryByRole("button", { name: "Back to new" })).toBeNull();
    for (const name of ["Mark seen", "Applied", "Not interested"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Applied" }));
    expect(setStatus).toHaveBeenCalledWith("applied");
  });

  it("shows the status of a triaged job and lets you put it back", async () => {
    const { user, setStatus } = setup({ status: "dismissed" });
    expect(screen.getByText("Not interested", { selector: ".chip" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to new" }));
    expect(setStatus).toHaveBeenCalledWith("new");
  });

  it("shows an error from the action", async () => {
    const setStatus = vi.fn(async (): Promise<ActionResult> => ({ ok: false, error: "nope" }));
    render(<JobCard job={job()} setStatus={setStatus} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark seen" }));
    expect((await screen.findByRole("alert")).textContent).toBe("nope");
  });

  it("copes with a job that has no company, place or alert", () => {
    setup({ company_name: null, location: null, work_mode: null, saved_search: null, is_internship: false, seen_in: [] });
    expect(screen.getByText("No company listed")).toBeTruthy();
    expect(screen.queryByText("Internship")).toBeNull();
    expect(screen.getByText("LinkedIn alert")).toBeTruthy(); // falls back to the source
  });
});

const source = (over: Partial<JobSourceRow> = {}): JobSourceRow => ({
  id: "s1",
  kind: "greenhouse",
  slug: "acme",
  label: "Acme",
  enabled: true,
  last_pulled_at: "2026-10-16T05:00:00Z",
  last_status: "ok",
  last_job_count: 214,
  last_new_count: 6,
  ...over,
});

describe("JobSourcesPanel", () => {
  const setup = (sources: JobSourceRow[], add?: (p: FormState, f: FormData) => Promise<FormState>) => {
    const props = {
      add: vi.fn(add ?? (async (): Promise<FormState> => ({ ok: true, message: "Added. The board lists 3 jobs; 2 are in your role families and 2 are new.", nonce: 1 }))),
      pull: vi.fn(ok),
      pullAll: vi.fn(ok),
      setEnabled: vi.fn(ok),
      remove: vi.fn(ok),
    };
    render(<JobSourcesPanel sources={sources} {...props} />);
    return { user: userEvent.setup(), ...props };
  };

  it("adds a board and reports what the first pull found", async () => {
    const { user, add } = setup([]);
    await user.selectOptions(screen.getByLabelText("Job board system"), "lever");
    await user.type(screen.getByLabelText(/Board name or careers-page address/), "jobs.lever.co/acme");
    await user.type(screen.getByLabelText(/Company name/), "Acme");
    await user.click(screen.getByRole("button", { name: "Add and check it" }));
    const fd = (add.mock.calls[0] as unknown as [FormState, FormData])[1];
    expect(Object.fromEntries(fd.entries())).toEqual({ kind: "lever", slug: "jobs.lever.co/acme", company: "Acme" });
    expect((await screen.findByRole("status")).textContent).toMatch(/lists 3 jobs; 2 are in your role families and 2 are new/);
  });

  it("shows an error and keeps what you typed", async () => {
    const { user } = setup([], async () => ({ error: "That board is already added." }));
    await user.type(screen.getByLabelText(/Board name/), "acme");
    await user.click(screen.getByRole("button", { name: "Add and check it" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That board is already added.");
    expect((screen.getByLabelText(/Board name/) as HTMLInputElement).value).toBe("acme");
  });

  it("explains an empty list", () => {
    setup([]);
    expect(screen.getByText(/No company boards yet/)).toBeTruthy();
  });

  it("shows each board's last pull: counts when it worked, the reason when it didn't", () => {
    setup([source(), source({ id: "s2", slug: "broken", label: null, last_status: "No such board. Check the name.", last_job_count: null, last_new_count: null }), source({ id: "s3", slug: "new", last_pulled_at: null, last_status: null })]);
    expect(screen.getByText(/214 listed, 6 new/)).toBeTruthy();
    expect(screen.getByText("Last pull failed: No such board. Check the name.")).toBeTruthy();
    expect(screen.getByText("Not pulled yet")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "broken" })).toBeTruthy(); // no label: falls back to the board name
  });

  it("pulls, pauses and resumes through the supplied actions", async () => {
    const { user, pull, pullAll, setEnabled } = setup([source(), source({ id: "s2", slug: "other", enabled: false })]);
    await user.click(screen.getAllByRole("button", { name: "Pull now" })[0]!);
    expect(pull).toHaveBeenCalledWith("s1");
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(setEnabled).toHaveBeenCalledWith("s1", false);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(setEnabled).toHaveBeenCalledWith("s2", true);
    expect(screen.getByText("Paused")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pull all now" }));
    expect(pullAll).toHaveBeenCalledTimes(1);
  });

  it("asks before removing, and can be cancelled", async () => {
    const { user, remove } = setup([source()]);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText("Jobs already found stay in your feed.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Yes, remove it" }));
    expect(remove).toHaveBeenCalledWith("s1");
  });
});
