import { describe, expect, it } from "vitest";
import { getEnvValue, setEnvValues } from "@/lib/env-file";

const base = ["# comment", "", "A=", "B=keep", "INGEST_SHARED_SECRET=abc", ""].join("\n");

describe("setEnvValues", () => {
  it("replaces only the named keys and leaves everything else byte-identical", () => {
    expect(setEnvValues(base, { A: "one" })).toBe(["# comment", "", "A=one", "B=keep", "INGEST_SHARED_SECRET=abc", ""].join("\n"));
  });

  it("appends missing keys with a single trailing newline", () => {
    expect(setEnvValues(base, { C: "3" })).toBe(base + "C=3\n");
    expect(setEnvValues("X=1", { Y: "2" })).toBe("X=1\nY=2\n");
    expect(setEnvValues("", { Y: "2" })).toBe("Y=2\n");
  });

  it("keeps CRLF files CRLF", () => {
    expect(setEnvValues("A=\r\nB=2\r\n", { A: "1" })).toBe("A=1\r\nB=2\r\n");
  });

  it("does not interpret $ or = inside values", () => {
    expect(setEnvValues("A=\n", { A: "x$&y=z" })).toBe("A=x$&y=z\n");
  });

  it("does not touch a key that merely starts with the same letters", () => {
    expect(setEnvValues("SUPABASE_SECRET_KEY=\nSUPABASE_SECRET_KEY_OLD=1\n", { SUPABASE_SECRET_KEY: "s" })).toBe("SUPABASE_SECRET_KEY=s\nSUPABASE_SECRET_KEY_OLD=1\n");
  });

  it("rejects multi-line values and bad key names", () => {
    expect(() => setEnvValues(base, { A: "a\nB=evil" })).toThrow(/single line/);
    expect(() => setEnvValues(base, { "a b": "x" })).toThrow(/Invalid env key/);
  });
});

describe("getEnvValue", () => {
  it("reads a value, trimmed, or empty", () => {
    expect(getEnvValue("A= x \nB=\n", "A")).toBe("x");
    expect(getEnvValue("A= x \nB=\n", "B")).toBe("");
    expect(getEnvValue("A=1\r\nB=2\r\n", "B")).toBe("2");
    expect(getEnvValue("A=1\n", "MISSING")).toBe("");
  });
});
