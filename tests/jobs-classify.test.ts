import { describe, expect, it } from "vitest";
import { classifyRole, isInternship, isRoleFamily, ROLE_FAMILIES, softKey } from "@/lib/jobs/classify";

describe("classifyRole", () => {
  it.each([
    // straight from the real job alert
    ["Lead Advanced Analytics, Community Support", "data_analytics"],
    ["Sustainability Data Analyst", "data_analytics"],
    ["Applied Scientist", "ml"],
    ["Data Scientist, Knowledge Management", "data_science"],
    ["Analyst - II", "data_analytics"],
    ["Principal AI Data Analyst", "ai"],
    ["Machine Learning Intern", "ml"],
    // the six families
    ["Product Analyst", "product_analytics"],
    ["Senior Product Analytics Manager", "product_analytics"],
    ["Growth Analyst Intern", "product_analytics"],
    ["Data Analyst Intern", "data_analytics"],
    ["Business Analyst", "data_analytics"],
    ["Data Science Intern", "data_science"],
    ["Decision Scientist", "data_science"],
    ["ML Engineer", "ml"],
    ["MLOps Engineer", "ml"],
    ["Computer Vision Researcher", "ml"],
    ["AI/ML Engineer", "ml"],
    ["Generative AI Engineer", "ai"],
    ["LLM Engineer", "ai"],
    ["GenAI Developer", "ai"],
    ["Software Engineer", "swe"],
    ["SDE Intern", "swe"],
    ["SDE-2", "swe"],
    ["Full Stack Developer", "swe"],
    ["Backend Engineer", "swe"],
    ["Frontend Developer (React)", "swe"],
    ["Data Engineer", "swe"],
    ["Android Developer", "swe"],
    // not for you
    ["Financial Analyst", "other"],
    ["Credit Risk Analyst", "other"],
    ["HR Analyst", "other"],
    ["Marketing Manager", "other"],
    ["Mechanical Engineer", "other"],
    ["Customer Support Executive", "other"],
    ["", "other"],
  ] as const)("%s -> %s", (title, family) => expect(classifyRole(title)).toBe(family));

  it("does not match inside other words", () => {
    expect(classifyRole("Chain Administrator")).toBe("other"); // contains 'ai'
    expect(classifyRole("Email Marketing Lead")).toBe("other"); // contains 'ai' and 'ml' letters
    expect(classifyRole("Paid Media Specialist")).toBe("other");
  });

  it("only ever returns a known family", () => {
    for (const t of ["x", "Data Analyst", "AI", "Engineer"]) expect(isRoleFamily(classifyRole(t))).toBe(true);
    expect(ROLE_FAMILIES).toHaveLength(6);
  });
});

describe("isRoleFamily", () => {
  it("accepts the families and 'other' only", () => {
    for (const f of [...ROLE_FAMILIES, "other"]) expect(isRoleFamily(f)).toBe(true);
    for (const bad of ["", "swe ", "DATA", null, undefined, 3]) expect(isRoleFamily(bad)).toBe(false);
  });
});

describe("isInternship", () => {
  it.each([
    ["Machine Learning Intern", null, true],
    ["Software Engineering Internship", null, true],
    ["Data Analyst Trainee", null, true],
    ["Summer Interns, Data", null, true],
    ["Data Analyst", "Intern", true],
    ["Data Analyst", "Internship", true],
    ["Data Analyst", "FullTime", false],
    ["International Sales Analyst", null, false],
    ["Internal Tools Engineer", null, false],
    ["Data Analyst", undefined, false],
  ])("%s / %s -> %s", (title, type, expected) => expect(isInternship(title, type)).toBe(expected));
});

describe("softKey", () => {
  it("is the same for the same opening written slightly differently", () => {
    const a = softKey("Dexter's Tech", "Machine Learning Intern", "India");
    expect(a).toBe(softKey("Dexters Tech Pvt. Ltd.", "Machine  Learning intern!", "India"));
  });
  it("uses only the first part of a location, so city beats 'Bengaluru, Karnataka, India'", () => {
    expect(softKey("Airbnb", "Data Analyst", "Bengaluru")).toBe(softKey("Airbnb", "Data Analyst", "Bengaluru, Karnataka, India"));
  });
  it("tells different openings apart", () => {
    expect(softKey("Airbnb", "Data Analyst", "Bengaluru")).not.toBe(softKey("Airbnb", "Data Scientist", "Bengaluru"));
    expect(softKey("Airbnb", "Data Analyst", "Bengaluru")).not.toBe(softKey("Airbnb", "Data Analyst", "Mumbai"));
    expect(softKey("Airbnb", "Data Analyst", "Bengaluru")).not.toBe(softKey("Zepto", "Data Analyst", "Bengaluru"));
  });
  it("normalises '&' and unicode", () => {
    expect(softKey("AT&T", "Dätä Analyst", null)).toBe("at and t|dätä analyst|");
  });
  it("returns null when there is nothing to compare", () => {
    expect(softKey(null, "Data Analyst", "Pune")).toBeNull();
    expect(softKey("  ", "Data Analyst", "Pune")).toBeNull();
    expect(softKey("Acme", "!!!", "Pune")).toBeNull();
  });
});
