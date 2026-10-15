// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptedCard } from "@/components/AcceptedCard";
import type { ActionResult, MarkSentInput } from "@/lib/action-types";
import { renderTemplate } from "@/lib/templates/engine";
import { company, lastMessage, person, templateRows } from "./helpers/fixtures";

afterEach(cleanup);

const templates = templateRows();
const t = (key: string) => templates.find((x) => x.key === key)!;
const ok: ActionResult = { ok: true };

function setup(props: Partial<React.ComponentProps<typeof AcceptedCard>> = {}) {
  const onMarkSent = vi.fn<(input: MarkSentInput) => Promise<ActionResult>>(async () => ok);
  const user = userEvent.setup();
  render(
    <AcceptedCard
      person={person()}
      company={company()}
      templates={templates}
      lastMessage={null}
      showPhotos
      onMarkSent={onMarkSent}
      {...props}
    />,
  );
  const textarea = () => screen.getByLabelText("Message") as HTMLTextAreaElement;
  const select = () => screen.getByLabelText("Template") as HTMLSelectElement;
  return { user, onMarkSent, textarea, select };
}

describe("template selection and rendering", () => {
  it("auto-selects the template for the company's category and fills it in exactly", () => {
    const { textarea, select } = setup();
    expect(select().value).toBe("template_2"); // quick_commerce
    expect(textarea().value).toBe(renderTemplate(t("template_2").body, { firstName: "Priya", company: "Zepto" }));
    expect(screen.getByText(/Auto-selected for Quick commerce/)).toBeTruthy();
  });

  it.each([
    ["food_delivery", "template_3"],
    ["other_relevant", "template_1"],
    ["small_startup", "template_4"],
  ] as const)("%s -> %s", (category, key) => {
    const { select } = setup({ company: company({ category }) });
    expect(select().value).toBe(key);
  });

  it("lets you override the template and says so", async () => {
    const { user, textarea, select } = setup();
    await user.selectOptions(select(), "template_3");
    expect(textarea().value).toBe(renderTemplate(t("template_3").body, { firstName: "Priya", company: "Zepto" }));
    expect(screen.getByText(/Manual override\. Auto would be Template 2/)).toBeTruthy();
  });

  it("uses a first_name override when the person has one", () => {
    const { textarea } = setup({ person: person({ first_name: "Pri" }) });
    expect(textarea().value.startsWith("Hey Pri, I'm Afreen!")).toBe(true);
  });

  it("shows the anime warning for template 4 without touching its text", async () => {
    const { user, textarea, select } = setup();
    expect(screen.queryByText(/certified anime lover/, { selector: "p" })).toBeNull();
    await user.selectOptions(select(), "template_4");
    expect(screen.getByRole("note").textContent).toMatch(/anime/i);
    expect(textarea().value).toContain("as a certified anime lover, love your work and company");
  });

  it("falls back to the general template and flags the missing company", () => {
    const { select, textarea } = setup({ company: null, person: person({ company_id: null, company_name_raw: null }) });
    expect(select().value).toBe("template_1");
    expect(screen.getByText(/No company set/)).toBeTruthy();
    expect(textarea().value).toContain("{{Company}}"); // left visible, not silently blanked
    expect(screen.getByRole("alert").textContent).toContain("{{Company}}");
  });
});

describe("editing", () => {
  it("counts characters, tracks edits, and resets to the template", async () => {
    const { user, textarea } = setup();
    const original = textarea().value;
    expect(screen.getByText(`${[...original].length} characters`)).toBeTruthy();

    fireEvent.change(textarea(), { target: { value: original + " 🙂" } });
    expect(screen.getByText(`${[...original].length + 2} characters · edited`)).toBeTruthy(); // emoji counts once

    await user.click(screen.getByRole("button", { name: "Reset to template" }));
    expect(textarea().value).toBe(original);
    expect(screen.getByText(`${[...original].length} characters`)).toBeTruthy();
  });

  it("discards edits when the template changes", async () => {
    const { user, textarea, select } = setup();
    fireEvent.change(textarea(), { target: { value: "my custom text" } });
    await user.selectOptions(select(), "template_1");
    expect(textarea().value).toBe(renderTemplate(t("template_1").body, { firstName: "Priya", company: "Zepto" }));
  });
});

describe("copy", () => {
  it("copies exactly what is in the textarea, edits included", async () => {
    const { user, textarea } = setup();
    fireEvent.change(textarea(), { target: { value: "Hey Priya, tweaked!" } });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe("Hey Priya, tweaked!");
    expect(screen.getByRole("button", { name: "Copied ✓" })).toBeTruthy();
  });
});

describe("mark as sent", () => {
  it("logs the template, its version and the exact final text", async () => {
    const { user, onMarkSent, textarea } = setup();
    fireEvent.change(textarea(), { target: { value: "final words " } });
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect(onMarkSent).toHaveBeenCalledTimes(1);
    expect(onMarkSent).toHaveBeenCalledWith({
      personId: person().id,
      templateId: t("template_2").template_id,
      templateVersion: 1,
      finalText: "final words ",
      allowDuplicate: false,
    });
    expect(await screen.findByText(/Marked as sent/)).toBeTruthy();
  });

  it("records the overridden template, not the auto one", async () => {
    const { user, onMarkSent, select } = setup();
    await user.selectOptions(select(), "template_3");
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect(onMarkSent.mock.calls[0]![0].templateId).toBe(t("template_3").template_id);
  });

  it("shows an error from the server and stays usable", async () => {
    const onMarkSent = vi.fn(async (): Promise<ActionResult> => ({ ok: false, error: "boom" }));
    const { user } = setup({ onMarkSent });
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect((await screen.findAllByRole("alert")).some((a) => a.textContent === "boom")).toBe(true);
    expect((screen.getByRole("button", { name: "Mark as sent" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks a double send until you confirm (duplicate-send prevention)", async () => {
    const { user, onMarkSent } = setup({
      person: person({ messages_sent_count: 1, last_messaged_at: "2026-10-10T10:00:00Z" }),
      lastMessage: lastMessage(),
    });
    expect(screen.getByText(/Already messaged/)).toBeTruthy();
    expect(screen.getByText(/with Template 2 v1/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect(onMarkSent).not.toHaveBeenCalled(); // first click only asks

    await user.click(screen.getByRole("button", { name: "Yes, mark as sent again" }));
    expect(onMarkSent).toHaveBeenCalledWith(expect.objectContaining({ allowDuplicate: true }));
  });

  it("can be cancelled out of the confirmation", async () => {
    const { user, onMarkSent } = setup({ person: person({ messages_sent_count: 2 }) });
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeTruthy();
    expect(onMarkSent).not.toHaveBeenCalled();
  });

  it("falls into the confirmation when the server reports a duplicate we didn't know about", async () => {
    const onMarkSent = vi
      .fn<(input: MarkSentInput) => Promise<ActionResult>>()
      .mockResolvedValueOnce({ ok: false, code: "already_messaged", error: "already" })
      .mockResolvedValueOnce(ok);
    const { user } = setup({ onMarkSent });
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await user.click(await screen.findByRole("button", { name: "Yes, mark as sent again" }));
    await waitFor(() => expect(onMarkSent).toHaveBeenCalledTimes(2));
    expect(onMarkSent.mock.calls[1]![0].allowDuplicate).toBe(true);
  });
});

describe("links and photos", () => {
  it("opens the profile in a new tab without leaking the referrer", () => {
    setup();
    const link = screen.getByRole("link", { name: /Open profile/ });
    expect(link.getAttribute("href")).toBe("https://www.linkedin.com/in/priya-sharma/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("never renders a non-http(s) profile URL as a link", () => {
    setup({ person: person({ profile_url: "javascript:alert(1)" }) });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("loads a photo only when allowed, without a referrer, and falls back to initials", () => {
    const photo = "https://media.licdn.com/dms/image/abc/photo.jpg";
    const { container } = render(
      <AcceptedCard person={person({ photo_url: photo })} company={company()} templates={templates} lastMessage={null} showPhotos onMarkSent={async () => ok} />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(photo);
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".avatar")!.textContent).toBe("PS");
  });

  it("makes no image request at all when photos are switched off", () => {
    const { container } = render(
      <AcceptedCard person={person({ photo_url: "https://media.licdn.com/x.jpg" })} company={company()} templates={templates} lastMessage={null} showPhotos={false} onMarkSent={async () => ok} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
