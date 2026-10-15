// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationCard } from "@/components/ConversationCard";
import type { ActionResult } from "@/lib/action-types";
import type { PersonStatus } from "@/lib/db-types";
import { company, lastMessage, person } from "./helpers/fixtures";

afterEach(cleanup);

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const ok = async (): Promise<ActionResult> => ({ ok: true });

function setup(over: Parameters<typeof person>[0] = {}, props: { setStatus?: (s: PersonStatus) => Promise<ActionResult> } = {}) {
  const markReplied = vi.fn(ok);
  const markFollowedUp = vi.fn(ok);
  const setStatus = vi.fn(props.setStatus ?? ok);
  render(
    <ConversationCard
      person={person({ status: "messaged", last_messaged_at: daysAgo(6), messages_sent_count: 1, ...over })}
      company={company()}
      lastMessage={lastMessage({ sent_at: daysAgo(6), final_text: "the exact words I sent" })}
      templateName="Template 2"
      followUpDays={5}
      showPhotos={false}
      now={NOW}
      markReplied={markReplied}
      markFollowedUp={markFollowedUp}
      setStatus={setStatus}
    />,
  );
  return { user: userEvent.setup(), markReplied, markFollowedUp, setStatus };
}

describe("ConversationCard", () => {
  it("flags a follow-up that is due and says how long it has been quiet", () => {
    setup();
    expect(screen.getByText("Follow-up due · 6 days of silence")).toBeTruthy();
    expect(screen.getByText(/Messaged .* · Template 2 v1/)).toBeTruthy();
  });

  it("shows plain waiting time before the threshold", () => {
    setup({ last_messaged_at: daysAgo(2) });
    expect(screen.getByText("Waiting 2 days")).toBeTruthy();
    expect(screen.queryByText(/Follow-up due ·/)).toBeNull(); // the chip, not the status option
  });

  it("records a reply and a follow-up through the supplied actions", async () => {
    const { user, markReplied, markFollowedUp } = setup();
    await user.click(screen.getByRole("button", { name: "They replied" }));
    expect(markReplied).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "I followed up" }));
    expect(markFollowedUp).toHaveBeenCalledTimes(1);
  });

  it("offers neither once they have replied, and shows the reply date", () => {
    setup({ status: "replied", last_replied_at: "2026-10-14T10:00:00Z" });
    expect(screen.queryByRole("button", { name: "They replied" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I followed up" })).toBeNull();
    expect(screen.getByText("Replied 14 Oct")).toBeTruthy();
    expect(screen.queryByText(/Follow-up due ·/)).toBeNull(); // the chip, not the status option
  });

  it("counts follow-ups you logged", () => {
    setup({ follow_ups_count: 1 });
    expect(screen.getByText("1 follow-up")).toBeTruthy();
    cleanup();
    setup({ follow_ups_count: 3 });
    expect(screen.getByText("3 follow-ups")).toBeTruthy();
  });

  it("sets any of the ten statuses, and only enables the button when it changed", async () => {
    const { user, setStatus } = setup();
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["new", "requested", "accepted", "messaged", "replied", "follow_up_due", "referral", "interview", "offer", "dead"]);
    const button = screen.getByRole("button", { name: "Set status" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.selectOptions(select, "interview");
    expect(button.disabled).toBe(false);
    await user.click(button);
    expect(setStatus).toHaveBeenCalledWith("interview");
  });

  it("shows an error from the server", async () => {
    const { user } = setup({}, { setStatus: async () => ({ ok: false, error: "nope" }) });
    await user.selectOptions(screen.getByLabelText("Status"), "dead");
    await user.click(screen.getByRole("button", { name: "Set status" }));
    expect((await screen.findByRole("alert")).textContent).toBe("nope");
  });

  it("lets you re-read exactly what was sent", () => {
    setup();
    expect(screen.getByText("the exact words I sent")).toBeTruthy();
  });

  it("opens the profile safely", () => {
    setup();
    const link = screen.getByRole("link", { name: /Open profile/ });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
