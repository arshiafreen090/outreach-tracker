import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkEnv, classifyKey, judgeSchema } from "@/lib/doctor-checks";

describe("judgeSchema", () => {
  const err = "PGRST205: not found";
  it("passes when nothing is missing (an empty problem list must not be read as 'only app_owner')", () => {
    const c = judgeSchema(new Map(), 12, 10);
    expect(c.status).toBe("ok");
    expect(c.detail).toBe("10 tables and 2 views present");
  });
  it("says the SQL was never applied when everything is missing", () => {
    const all = new Map(Array.from({ length: 12 }, (_, i) => [`t${i}`, err] as const));
    const c = judgeSchema(all, 12, 10);
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/NONE of the tables/);
  });
  it("points at migration 0003 when only app_owner is missing", () => {
    const c = judgeSchema(new Map([["app_owner", err]]), 12, 10);
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/0003/);
  });
  it("points at migration 0004 when only accept_candidates is missing", () => {
    const c = judgeSchema(new Map([["accept_candidates", err]]), 13, 11);
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/0004/);
    expect(c.detail).not.toMatch(/0003/);
  });
  it("mentions both when both owner gate and accepts are missing", () => {
    const c = judgeSchema(new Map([["app_owner", err], ["accept_candidates", err]]), 13, 11);
    expect(c.detail).toMatch(/0003.*0004/);
  });
  it("lists exactly what is missing otherwise", () => {
    const c = judgeSchema(new Map([["people", err], ["jobs", err]]), 12, 10);
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/people .*jobs/);
    expect(c.detail).not.toMatch(/0003/);
  });
});

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
  SUPABASE_SECRET_KEY: "sb_secret_abc123",
  ALLOWED_EMAIL: "me@example.com",
  INGEST_SHARED_SECRET: "a".repeat(64),
};

const statusOf = (env: Record<string, string | undefined>, name: string) => checkEnv(env).find((c) => c.name === name)?.status;

describe("classifyKey", () => {
  it("recognises new and legacy keys", () => {
    expect(classifyKey("sb_publishable_x")).toBe("publishable");
    expect(classifyKey("sb_secret_x")).toBe("secret");
    expect(classifyKey(jwt("anon"))).toBe("legacy-anon");
    expect(classifyKey(jwt("service_role"))).toBe("legacy-service-role");
    expect(classifyKey("hello")).toBe("unknown");
    expect(classifyKey("a.b.c")).toBe("unknown");
  });
});

describe("checkEnv", () => {
  it("passes a correct configuration", () => {
    expect(checkEnv(good).every((c) => c.status === "ok")).toBe(true);
  });

  it("fails when the secret key is placed in the public variable (it would ship to every browser)", () => {
    expect(statusOf({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")).toBe("fail");
    expect(statusOf({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")).toBe("fail");
  });

  it("fails when the keys are swapped the other way", () => {
    expect(statusOf({ ...good, SUPABASE_SECRET_KEY: "sb_publishable_abc" }, "SUPABASE_SECRET_KEY")).toBe("fail");
    expect(statusOf({ ...good, SUPABASE_SECRET_KEY: jwt("anon") }, "SUPABASE_SECRET_KEY")).toBe("fail");
  });

  it("only warns for legacy keys", () => {
    expect(statusOf({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")).toBe("warn");
    expect(statusOf({ ...good, SUPABASE_SECRET_KEY: jwt("service_role") }, "SUPABASE_SECRET_KEY")).toBe("warn");
  });

  it.each([
    ["", "fail"],
    ["https://abc.supabase.co/rest/v1", "fail"],
    ["http://abc.supabase.co", "fail"],
    ["https://example.com", "fail"],
    ["https://abc.supabase.co/", "ok"],
  ])("url %j -> %s", (value, expected) => {
    expect(statusOf({ ...good, NEXT_PUBLIC_SUPABASE_URL: value }, "NEXT_PUBLIC_SUPABASE_URL")).toBe(expected);
  });

  it("requires a plausible allowed email, and warns on a missing ingest secret", () => {
    expect(statusOf({ ...good, ALLOWED_EMAIL: "" }, "ALLOWED_EMAIL")).toBe("fail");
    expect(statusOf({ ...good, ALLOWED_EMAIL: "not-an-email" }, "ALLOWED_EMAIL")).toBe("fail");
    expect(statusOf({ ...good, INGEST_SHARED_SECRET: "" }, "INGEST_SHARED_SECRET")).toBe("warn");
    expect(statusOf({ ...good, INGEST_SHARED_SECRET: "short" }, "INGEST_SHARED_SECRET")).toBe("warn");
  });
});

describe("migrations", () => {
  it("are plain ASCII so clipboard tools can't mangle them", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      expect(/[^\x00-\x7F]/.test(readFileSync(path.join(dir, file), "utf8")), file).toBe(false);
    }
  });
});
