import { existsSync, readFileSync } from "node:fs";

// Load .env.test into process.env for the smoke suites, so live credentials live
// in a git-ignored file instead of inline shell vars. Existing env wins (lets you
// still override per-run). No dotenv dependency — a tiny KEY=VALUE parser.
const FILE = ".env.test";
if (existsSync(FILE)) {
  for (const line of readFileSync(FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
