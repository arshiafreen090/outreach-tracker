import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkEnv, classifyKey } from "@/lib/doctor-checks";

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
