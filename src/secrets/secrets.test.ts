import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSecrets, secretKey } from "./secrets.js";

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "pl-sec-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FileSecrets", () => {
  it("round-trips namespaced keys", async () => {
    const s = new FileSecrets(join(dir, "secrets.json"));
    await s.set(secretKey("stripe", "secret"), "sk_test_abc");
    expect(await s.get(secretKey("stripe", "secret"))).toBe("sk_test_abc");
    expect(await s.get(secretKey("stripe", "missing"))).toBeUndefined();
  });

  it("writes the file 0600 (owner-only)", async () => {
    const file = join(dir, "secrets.json");
    const s = new FileSecrets(file);
    await s.set("k", "v");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("falls back to PL_ env var when key absent from file", async () => {
    process.env.PL_STRIPE_PUBLISHABLE = "pk_env";
    const s = new FileSecrets(join(dir, "secrets.json"));
    expect(await s.get("stripe.publishable")).toBe("pk_env");
    delete process.env.PL_STRIPE_PUBLISHABLE;
  });
});
