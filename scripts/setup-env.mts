/**
 * Interactive .env.local setup.
 *   npm run setup:env
 * Asks for the four Supabase values, hides the secret key while you type or paste it,
 * validates each one the same way `npm run doctor` does, and writes .env.local in place
 * (other lines such as INGEST_SHARED_SECRET are left alone). Never prints a secret.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline/promises";
import { checkEnv } from "../src/lib/doctor-checks";
import { getEnvValue, setEnvValues } from "../src/lib/env-file";

const ENV_PATH = new URL("../.env.local", import.meta.url);
const EXAMPLE_PATH = new URL("../.env.example", import.meta.url);

const FIELDS = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", prompt: "Project URL (https://<ref>.supabase.co)", hidden: false },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", prompt: "Publishable key (sb_publishable_...)", hidden: false },
  { key: "SUPABASE_SECRET_KEY", prompt: "Secret key (sb_secret_...). Hidden as you type", hidden: true },
  { key: "ALLOWED_EMAIL", prompt: "Your login email (the Auth user you created)", hidden: false },
] as const;

function readVisible(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(prompt).finally(() => rl.close());
}

/** Reads a line without echoing it. Handles paste (many characters per chunk) and Backspace. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("The hidden prompt needs an interactive terminal."));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          done();
          return reject(new Error("Cancelled."));
        }
        if (ch === "\r" || ch === "\n") {
          done();
          process.stdout.write(`\n`);
          return resolve(value);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

if (!process.stdin.isTTY) {
  console.error("This needs an interactive terminal (it hides the secret key as you type). Run it in a terminal tab: npm run setup:env");
  process.exit(1);
}

let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : readFileSync(EXAMPLE_PATH, "utf8");

console.log("Writing to .env.local. Press Enter on a field to keep its current value.\n");

for (const field of FIELDS) {
  const current = getEnvValue(text, field.key);
  for (;;) {
    const hint = current ? " [keep current]" : "";
    const raw = (field.hidden ? await readHidden(`${field.prompt}${hint}: `) : await readVisible(`${field.prompt}${hint}: `)).trim();
    const value = raw || current;
    const candidate = setEnvValues(text, { [field.key]: value });

    // Validate this field the same way `npm run doctor` does.
    const env = Object.fromEntries(FIELDS.map((f) => [f.key, getEnvValue(candidate, f.key)]));
    const check = checkEnv(env).find((c) => c.name === field.key);
    if (check?.status === "fail") {
      console.log(`  x ${check.detail}\n`);
      continue;
    }
    text = candidate;
    console.log(`  ok (${field.hidden ? `${value.length} characters, not shown` : value})\n`);
    break;
  }
}

writeFileSync(ENV_PATH, text, "utf8");
console.log("Saved .env.local. Next: npm run doctor");
