import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Secrets never touch the repo / .proofledger (which is git-committed). They live
// in the OS keychain when available, else a 0600 file under the user's home.
// Adapters receive values through this interface, never raw from disk logic.

export interface SecretsProvider {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/** Namespaced key, e.g. secretKey("stripe","secret") -> "stripe.secret". */
export function secretKey(provider: string, name: string): string {
  return `${provider}.${name}`;
}

const SERVICE = "proofledger";

/** OS keychain via keytar (lazy, optional). Falls back to file if unavailable. */
export class KeychainSecrets implements SecretsProvider {
  private mod?: Promise<{ getPassword: Function; setPassword: Function } | null>;
  private keytar() {
    if (!this.mod) {
      this.mod = import("keytar" as string)
        .then((m) => m.default ?? m)
        .catch(() => null);
    }
    return this.mod;
  }
  async get(key: string): Promise<string | undefined> {
    const kt = await this.keytar();
    if (!kt) throw new Error("keytar unavailable");
    return (await kt.getPassword(SERVICE, key)) ?? undefined;
  }
  async set(key: string, value: string): Promise<void> {
    const kt = await this.keytar();
    if (!kt) throw new Error("keytar unavailable");
    await kt.setPassword(SERVICE, key, value);
  }
}

/** Fallback: a single 0600 JSON file under ~/.proofledger. */
export class FileSecrets implements SecretsProvider {
  constructor(private file: string = join(homedir(), ".proofledger", "secrets.json")) {}
  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    return JSON.parse(readFileSync(this.file, "utf8")) as Record<string, string>;
  }
  async get(key: string): Promise<string | undefined> {
    return this.read()[key] ?? process.env[`PL_${key.replace(/\W/g, "_").toUpperCase()}`];
  }
  async set(key: string, value: string): Promise<void> {
    mkdirSync(dirname(this.file), { recursive: true });
    const all = this.read();
    all[key] = value;
    writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }
}

/** Prefer the keychain; degrade to the file store if keytar can't load. */
export async function resolveSecrets(): Promise<SecretsProvider> {
  const kc = new KeychainSecrets();
  try {
    await kc.get("__probe__");
    return kc;
  } catch {
    return new FileSecrets();
  }
}
