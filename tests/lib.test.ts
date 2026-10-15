import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "@/lib/auth-rules";
import { parseProfileUrl, safeHttpUrl } from "@/lib/urls";
import { DEFAULT_SETTINGS, parseDaysInput, parseSettings } from "@/lib/settings";
import { agoLabel, dateInputToDate, daysSince, todayInDisplayZone } from "@/lib/time";
import { initials } from "@/components/Avatar";
import { findUnknownPlaceholders } from "@/lib/templates/engine";
import { defaultTemplateFor } from "@/lib/templates/select";
import { templateRows } from "./helpers/fixtures";

describe("dateInputToDate (India time, no DST)", () => {
  const now = new Date("2026-10-16T12:00:00Z"); // 17:30 IST on the 16th
  it("treats today as 'now', past days as noon IST, and rejects the future", () => {
    expect(dateInputToDate("2026-10-16", now)).toBe(now);
    expect(dateInputToDate("2026-10-10", now)?.toISOString()).toBe("2026-10-10T06:30:00.000Z");
    expect(dateInputToDate("2026-10-17", now)).toBeNull();
    for (const bad of ["", "tomorrow", "2026-13-40", "16/10/2026", "2026-1-5"]) expect(dateInputToDate(bad, now)).toBeNull();
  });
  it("uses the display-zone calendar day, not the UTC one", () => {
    const lateUtc = new Date("2026-10-16T20:00:00Z"); // already 01:30 on the 17th in IST
    expect(todayInDisplayZone(lateUtc)).toBe("2026-10-17");
    expect(dateInputToDate("2026-10-17", lateUtc)).toBe(lateUtc);
  });
});

describe("initials", () => {
  it.each([
    ["Priya Sharma", "PS"],
    ["madonna", "M"],
    ["Jean-Luc Picard", "JP"],
    ["  Asha   Rao  ", "AR"],
    ["   ", "?"],
  ])("%j -> %j", (name, expected) => expect(initials(name)).toBe(expected));
});

describe("template helpers", () => {
  it("findUnknownPlaceholders flags typos once each and ignores the real three", () => {
    expect(findUnknownPlaceholders("{{first_name}} {{Company}} {{COMPANY_UPPER}}")).toEqual([]);
    expect(findUnknownPlaceholders("{{company}} {{Company}} {{x}} {{x}}")).toEqual(["{{company}}", "{{x}}"]);
    for (const t of templateRows()) expect(findUnknownPlaceholders(t.body), t.key).toEqual([]);
  });

  it("defaultTemplateFor follows the category, falls back to the general template, and never throws", () => {
    const rows = templateRows();
    expect(defaultTemplateFor("quick_commerce", rows)?.key).toBe("template_2");
    expect(defaultTemplateFor("small_startup", rows)?.key).toBe("template_4");
    expect(defaultTemplateFor(null, rows)?.key).toBe("template_1");
    expect(defaultTemplateFor("food_delivery", [])).toBeUndefined();
    // a category with no default template falls back to the first template
    const noDefaults = rows.map((r) => ({ ...r, default_category: null }));
    expect(defaultTemplateFor("quick_commerce", noDefaults)?.key).toBe("template_1");
  });
});

describe("isAllowedEmail", () => {
  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(isAllowedEmail("  Me@Example.com ", "me@example.com")).toBe(true);
    expect(isAllowedEmail("me@example.com", " ME@example.com")).toBe(true);
  });
  it("fails closed", () => {
    expect(isAllowedEmail("me@example.com", undefined)).toBe(false);
    expect(isAllowedEmail("me@example.com", "")).toBe(false);
    expect(isAllowedEmail("me@example.com", "   ")).toBe(false);
    expect(isAllowedEmail(undefined, "me@example.com")).toBe(false);
    expect(isAllowedEmail("", "")).toBe(false);
    expect(isAllowedEmail("other@example.com", "me@example.com")).toBe(false);
    expect(isAllowedEmail("me@example.com.evil.com", "me@example.com")).toBe(false);
  });
});

describe("parseProfileUrl", () => {
  it.each([
    ["https://www.linkedin.com/in/priya-sharma-1a2b3c/", "in/priya-sharma-1a2b3c"],
    ["https://www.linkedin.com/in/priya-sharma-1a2b3c", "in/priya-sharma-1a2b3c"],
    ["www.linkedin.com/in/Priya-Sharma-1A2B3C?utm_source=share&utm_medium=member_ios", "in/priya-sharma-1a2b3c"],
    ["linkedin.com/in/priya-sharma-1a2b3c/details/experience/", "in/priya-sharma-1a2b3c"],
    ["  http://ca.linkedin.com/in/priya#about  ", "in/priya"],
    ["https://in.linkedin.com/IN/Priya/", "in/priya"],
    ["https://www.linkedin.com/in/J%C3%BCrgen-M%C3%BCller/", "in/jürgen-müller"],
  ])("%s -> %s", (input, key) => {
    const r = parseProfileUrl(input);
    expect(r?.key).toBe(key);
    expect(r?.url).toMatch(/^https:\/\/www\.linkedin\.com\/in\/[^/?#]+\/$/);
  });

  it("gives the same key for every spelling of the same profile", () => {
    const keys = [
      "https://www.linkedin.com/in/asha-rao/",
      "http://linkedin.com/in/ASHA-RAO",
      "in.linkedin.com/in/asha-rao/?trk=abc",
    ].map((u) => parseProfileUrl(u)?.key);
    expect(new Set(keys).size).toBe(1);
  });

  it.each([
    "",
    "   ",
    "not a url",
    "https://example.com/in/priya",
    "https://linkedin.com.evil.com/in/priya",
    "https://evil-linkedin.com/in/priya",
    "https://www.linkedin.com/company/zepto/",
    "https://www.linkedin.com/in/",
    "https://www.linkedin.com/feed/",
    "javascript:alert(1)",
    "ftp://www.linkedin.com/in/priya",
  ])("rejects %j", (input) => {
    expect(parseProfileUrl(input)).toBeNull();
  });
});

describe("safeHttpUrl", () => {
  it("allows http(s) only", () => {
    expect(safeHttpUrl("https://www.linkedin.com/in/x/")).toBe("https://www.linkedin.com/in/x/");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "//evil.com", "not a url", "", null, undefined]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });
});

describe("settings", () => {
  it("falls back to defaults for missing or malformed values", () => {
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings([
        { key: "follow_up_days", value: "five" },
        { key: "pending_nudge_days", value: 0 },
        { key: "show_photos", value: "yes" },
      ]),
    ).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([{ key: "follow_up_days", value: 400 }]).followUpDays).toBe(DEFAULT_SETTINGS.followUpDays);
    expect(parseSettings([{ key: "follow_up_days", value: 2.5 }]).followUpDays).toBe(DEFAULT_SETTINGS.followUpDays);
  });
  it("reads valid values", () => {
    expect(
      parseSettings([
        { key: "follow_up_days", value: 3 },
        { key: "pending_nudge_days", value: 10 },
        { key: "show_photos", value: false },
      ]),
    ).toEqual({ followUpDays: 3, pendingNudgeDays: 10, showPhotos: false });
  });
  it("parses typed day counts strictly", () => {
    expect(parseDaysInput("7")).toBe(7);
    expect(parseDaysInput(" 365 ")).toBe(365);
    for (const bad of ["0", "366", "-1", "1.5", "abc", "", "1e2", null]) expect(parseDaysInput(bad)).toBeNull();
  });
});

describe("time helpers", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it("counts whole days and never goes negative", () => {
    expect(daysSince("2026-10-16T01:00:00Z", now)).toBe(0);
    expect(daysSince("2026-10-15T11:59:00Z", now)).toBe(1);
    expect(daysSince("2026-10-09T12:00:00Z", now)).toBe(7);
    expect(daysSince("2026-10-20T12:00:00Z", now)).toBe(0);
  });
  it("labels days", () => {
    expect(agoLabel(0)).toBe("today");
    expect(agoLabel(1)).toBe("1 day ago");
    expect(agoLabel(9)).toBe("9 days ago");
  });
});
