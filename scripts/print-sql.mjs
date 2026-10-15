// Prints every migration in order, ready to paste into the Supabase SQL Editor in one go.
//   npm run sql:copy     (Windows: puts it on your clipboard via `clip`)
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../supabase/migrations/", import.meta.url);
const all = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
// --latest: only the newest migration, for projects where the earlier ones are already applied.
const files = process.argv.includes("--latest") ? all.slice(-1) : all;
process.stdout.write(files.map((f) => `-- ===== ${f} =====\n${readFileSync(new URL(f, dir), "utf8")}`).join("\n"));
