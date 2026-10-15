// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptCandidateCard } from "@/components/AcceptCandidateCard";
import type { ActionResult, FormState } from "@/lib/action-types";
import type { AcceptCandidate } from "@/lib/db-types";
import { company } from "./helpers/fixtures";

afterEach(cleanup);

const candidate = (over: Partial<AcceptCandidate> = {}): AcceptCandidate => ({
  id: "00000000-0000-4000-8000-0000000000k1",
  full_name: "Alpha Tester",
  headline: "Founding team at Beta Labs",
  company_hint: "Beta Labs",
  profile_url: "https://www.linkedin.com/in/alpha-tester/",
  profile_url_key: "in/alpha-tester",
  photo_url: null,
  accepted_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  status: "unmatched",
  match_method: null,
  person_id: null,
  ...over,
});

function setup(props: { pending?: { id: string; label: string }[]; candidate?: AcceptCandidate } = {}) {
  const link = vi.fn(async (): Promise<FormState> => ({ ok: true, message: "Linked.", nonce: 1 }));
  const create = vi.fn(async (): Promise<FormState> => ({ ok: true, message: "Added.", nonce: 1 }));
  const dismiss = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
  render(
    <AcceptCandidateCard
      candidate={props.candidate ?? candidate()}
      pending={props.pending ?? [{ id: "p-1", label: "Karan Mehta (Swiggy)" }, { id: "p-2", label: "Sana Qureshi (Zepto)" }]}
      companies={[company()]}
      showPhotos={false}
      link={link}
      create={create}
      dismiss={dismiss}
    />,
  );
  return { user: userEvent.setup(), link, create, dismiss };
}

const formData = (mock: ReturnType<typeof vi.fn>) => (mock.mock.calls[0] as unknown as [FormState, FormData])[1];

describe("AcceptCandidateCard", () => {
  it("shows who accepted, their headline and the company guess", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Alpha Tester" })).toBeTruthy();
    expect(screen.getByText("Founding team at Beta Labs")).toBeTruthy();
    expect(screen.getByText("Maybe at Beta Labs")).toBeTruthy();
    expect(screen.getByText("Accepted 3 days ago")).toBeTruthy();
  });

  it("opens the profile safely in a new tab, and never renders an unsafe link", () => {
    setup();
    const link = screen.getByRole("link", { name: /Open profile/ });
    expect(link.getAttribute("href")).toBe("https://www.linkedin.com/in/alpha-tester/");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    cleanup();
    setup({ candidate: candidate({ profile_url: "javascript:alert(1)" }) });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links the chosen pending request", async () => {
    const { user, link } = setup();
    await user.selectOptions(screen.getByLabelText("Which request is this?"), "p-2");
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(link).toHaveBeenCalledTimes(1);
    expect(formData(link).get("person_id")).toBe("p-2");
    expect(await screen.findByRole("button", { name: "Link" })).toBeTruthy();
  });

  it("will not submit a link without choosing a request", async () => {
    const { user, link } = setup();
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(link).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to link to", () => {
    setup({ pending: [] });
    expect(screen.getByText("You have no pending requests to link to.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
  });

  it("prefills the company from the guess and lets you correct it before adding", async () => {
    const { user, create } = setup();
    const input = screen.getByLabelText("Company") as HTMLInputElement;
    expect(input.value).toBe("Beta Labs");
    await user.clear(input);
    await user.type(input, "Zepto");
    await user.click(screen.getByRole("button", { name: "Add to Accepted" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(formData(create).get("company")).toBe("Zepto");
  });

  it("asks for a category only when the company is new", async () => {
    const { user } = setup();
    expect(screen.getByLabelText("Category for new company")).toBeTruthy(); // "Beta Labs" is not an existing company
    const input = screen.getByLabelText("Company");
    await user.clear(input);
    await user.type(input, "Zepto");
    expect(screen.queryByLabelText("Category for new company")).toBeNull();
  });

  it("dismisses through the supplied action", async () => {
    const { user, dismiss } = setup();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("copes with no headline and no company guess", () => {
    setup({ candidate: candidate({ headline: null, company_hint: null }) });
    expect(screen.getByText("No headline in the email")).toBeTruthy();
    expect(screen.queryByText(/Maybe at/)).toBeNull();
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe("");
  });

  it("shows initials and loads no image when photos are off", () => {
    const { container } = render(
      <AcceptCandidateCard
        candidate={candidate({ photo_url: "https://media.licdn.com/dms/image/v2/A/profile-displayphoto-scale_400_400/x" })}
        pending={[]}
        companies={[]}
        showPhotos={false}
        link={async () => ({})}
        create={async () => ({})}
        dismiss={async () => ({ ok: true })}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(within(container).getByText("AT")).toBeTruthy();
  });
});
