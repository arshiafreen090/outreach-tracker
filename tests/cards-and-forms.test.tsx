// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyField } from "@/components/CompanyField";
import { LogRequestForm } from "@/components/LogRequestForm";
import { PendingCard } from "@/components/PendingCard";
import { TemplateEditor } from "@/components/TemplateEditor";
import type { ActionResult, FormState } from "@/lib/action-types";
import { company, person, templateRows } from "./helpers/fixtures";

afterEach(cleanup);

const NOW = new Date("2026-10-16T12:00:00Z");
const pendingPerson = (requestedAt: string) => person({ status: "requested", requested_at: requestedAt, accepted_at: null });

describe("PendingCard", () => {
  const renderCard = (requestedAt: string, markAccepted = vi.fn(async (): Promise<ActionResult> => ({ ok: true }))) => {
    render(
      <PendingCard person={pendingPerson(requestedAt)} company={company()} showPhotos={false} nudgeDays={7} now={NOW} markAccepted={markAccepted} />,
    );
    return markAccepted;
  };

  it("shows a nudge once the request has been pending for N days", () => {
    renderCard("2026-10-09T12:00:00Z"); // exactly 7 days
    expect(screen.getByText("Nudge: pending 7 days")).toBeTruthy();
  });

  it("does not nudge before N days", () => {
    renderCard("2026-10-10T12:00:00Z"); // 6 days
    expect(screen.queryByText(/Nudge/)).toBeNull();
    expect(screen.getByText(/6 days ago/)).toBeTruthy();
  });

  it("marks accepted through the supplied action", async () => {
    const markAccepted = renderCard("2026-10-12T12:00:00Z");
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark accepted" }));
    expect(markAccepted).toHaveBeenCalledTimes(1);
  });

  it("shows an action error inline", async () => {
    const failing = vi.fn(async (): Promise<ActionResult> => ({ ok: false, error: "nope" }));
    renderCard("2026-10-12T12:00:00Z", failing);
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark accepted" }));
    expect((await screen.findByRole("alert")).textContent).toBe("nope");
  });
});

describe("CompanyField", () => {
  const companies = [company(), company({ id: "c2", name: "Swiggy", category: "food_delivery" })];

  it("only asks for a category when the company is new", async () => {
    const user = userEvent.setup();
    render(<CompanyField companies={companies} />);
    const input = screen.getByLabelText("Company");

    expect(screen.queryByLabelText("Category for new company")).toBeNull();
    await user.type(input, "zepto"); // matches case-insensitively
    expect(screen.queryByLabelText("Category for new company")).toBeNull();
    expect(screen.getByText("Category: Quick commerce")).toBeTruthy();

    await user.clear(input);
    await user.type(input, "Brand New Co");
    expect(screen.getByLabelText("Category for new company")).toBeTruthy();
  });
});

describe("LogRequestForm", () => {
  const action = vi.fn(async (): Promise<FormState> => ({ ok: true, message: "Logged.", nonce: 1 }));
  const known = { "in/asha-rao": "Asha Rao" };
  const setup = () => render(<LogRequestForm action={action} companies={[company()]} knownProfiles={known} />);

  it("recognises a profile URL and shows its matching key", async () => {
    setup();
    await userEvent.setup().type(screen.getByLabelText("LinkedIn profile URL"), "https://www.linkedin.com/in/New-Person-1a2b/?utm_source=x");
    expect(screen.getByText("Recognised: in/new-person-1a2b")).toBeTruthy();
  });

  it("warns instantly about an already-logged profile and blocks the submit", async () => {
    setup();
    await userEvent.setup().type(screen.getByLabelText("LinkedIn profile URL"), "linkedin.com/in/ASHA-RAO/");
    expect(screen.getByText("Already logged: Asha Rao.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Log request" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects things that aren't profile URLs", async () => {
    setup();
    await userEvent.setup().type(screen.getByLabelText("LinkedIn profile URL"), "https://example.com/in/someone");
    expect(screen.getByText(/Needs to look like linkedin\.com\/in/)).toBeTruthy();
  });

  it("submits the typed values to the action", async () => {
    action.mockClear();
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("LinkedIn profile URL"), "https://www.linkedin.com/in/new-person/");
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.type(screen.getByLabelText("Company"), "Zepto");
    await user.click(screen.getByRole("button", { name: "Log request" }));

    expect(action).toHaveBeenCalledTimes(1);
    const formData = (action.mock.calls[0] as unknown as [FormState, FormData])[1];
    expect(Object.fromEntries(formData.entries())).toMatchObject({
      profile_url: "https://www.linkedin.com/in/new-person/",
      full_name: "New Person",
      company: "Zepto",
    });
    expect(await screen.findByText(/Logged\. Add another below\./)).toBeTruthy();
    // the form re-keys on success, so it is ready for the next entry
    expect((screen.getByLabelText("LinkedIn profile URL") as HTMLInputElement).value).toBe("");
  });
});

describe("TemplateEditor", () => {
  const template = templateRows()[1]!;
  const setup = (action = vi.fn(async (): Promise<FormState> => ({ ok: true, message: "Saved as a new version.", nonce: 1 }))) => {
    render(<TemplateEditor template={template} versions={[{ version: 1, note: "Original text from templates/seed.md", created_at: "2026-10-01T00:00:00Z", body: template.body }]} action={action} />);
    return action;
  };

  it("starts with the exact current text and nothing to save", () => {
    setup();
    expect((screen.getByLabelText(/^Text/) as HTMLTextAreaElement).value).toBe(template.body);
    expect((screen.getByRole("button", { name: "Save as new version" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks saving an unknown placeholder such as {{company}}", async () => {
    setup();
    const area = screen.getByLabelText(/^Text/) as HTMLTextAreaElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(area, { target: { value: template.body + "\n{{company}}" } });
    expect(screen.getByRole("alert").textContent).toContain("{{company}}");
    expect((screen.getByRole("button", { name: "Save as new version" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the edited body and template id when saving", async () => {
    const action = setup();
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByLabelText(/^Text/), { target: { value: template.body + "\nP.S. hello" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save as new version" }));
    const formData = (action.mock.calls[0] as unknown as [FormState, FormData])[1];
    expect(formData.get("template_id")).toBe(template.template_id);
    expect(String(formData.get("body")).replace(/\r\n/g, "\n")).toBe(template.body + "\nP.S. hello");
  });

  it("lists version history", () => {
    setup();
    expect(screen.getByText(/Version history \(1\)/)).toBeTruthy();
  });
});
