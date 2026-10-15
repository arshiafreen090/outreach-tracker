/**
 * Checks /api/sheet the way the Sheet's Apps Script uses it, and prints a summary (counts, never names).
 *   npm run sheet:check                                   (against http://localhost:3000, `npm run dev` running)
 *   npm run sheet:check -- https://your-app.vercel.app    (after deploying)
 */
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.INGEST_SHARED_SECRET;
if (!secret) {
  console.error("INGEST_SHARED_SECRET must be set in .env.local.");
  process.exit(1);
}

let failed = 0;
const step = (ok: boolean, name: string, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failed++;
};

const get = (token: string | null) =>
  fetch(`${base}/api/sheet`, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: "manual" });

try {
  step((await get(null)).status === 401, "Refused without the secret");
  step((await get("x".repeat(40))).status === 401, "Refused with a wrong secret");

  const res = await get(secret);
  step(res.status === 200, "Answers with the secret", `HTTP ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; tabs?: { name: string; headers: string[]; rows: string[][] }[] };
  const tabs = body.tabs ?? [];
  step(tabs.map((t) => t.name).join("|") === "Accepted connections|Messaged|Pending requests", "Has the three tabs", tabs.map((t) => t.name).join(", "));
  step(tabs.every((t) => t.rows.every((r) => r.length === t.headers.length)), "Every row is as wide as its header");
  const cells = tabs.flatMap((t) => t.rows.flat());
  step(cells.every((c) => typeof c === "string"), "Every cell is text");
  step(cells.filter((c) => /^[=+\-@\t\r]/.test(c)).length === 0, "No cell can start a spreadsheet formula");
  for (const t of tabs) console.log(`      ${t.name}: ${t.rows.length} row(s)`);
} catch (e) {
  step(false, "Check aborted", (e as Error).message);
}

console.log(`\n${failed === 0 ? "Sheet endpoint works." : `${failed} step(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
