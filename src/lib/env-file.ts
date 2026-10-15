/**
 * Sets KEY=value lines in the text of an env file, leaving every other line (comments,
 * blank lines, other keys) and the file's line-ending style exactly as they were.
 * Keys that are missing are appended. Values may not contain line breaks.
 */
export function setEnvValues(text: string, values: Record<string, string>): string {
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`);
    if (/[\r\n]/.test(value)) throw new Error(`${key}: value must be a single line`);
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const pending = new Map(Object.entries(values));

  const updated = lines.map((line) => {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m && pending.has(m[1]!)) {
      const value = pending.get(m[1]!)!;
      pending.delete(m[1]!);
      return `${m[1]}=${value}`;
    }
    return line;
  });

  // Keep a single trailing newline when appending.
  if (pending.size > 0) {
    if (updated.length > 0 && updated[updated.length - 1] === "") updated.pop();
    for (const [key, value] of pending) updated.push(`${key}=${value}`);
    updated.push("");
  }
  return updated.join(eol);
}

/** The value of KEY in env-file text, or "" if absent. */
export function getEnvValue(text: string, key: string): string {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(text.replace(/\r/g, ""));
  return (m?.[1] ?? "").trim();
}
