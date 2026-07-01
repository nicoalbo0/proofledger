import { describe, expect, it } from "vitest";
import { doctor, renderDoctor } from "./doctor.js";
import { FileSecrets, secretKey, type SecretsProvider } from "../secrets/secrets.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchImpl } from "../adapters/http.js";

function freshSecrets(): SecretsProvider {
  return new FileSecrets(join(mkdtempSync(join(tmpdir(), "pl-doc-")), "s.json"));
}

describe("doctor", () => {
  it("reports missing keys per provider when nothing connected", async () => {
    const reports = await doctor(freshSecrets());
    const stripe = reports.find((r) => r.provider === "stripe")!;
    expect(stripe.present).toHaveLength(0);
    expect(stripe.missing).toContain("secret");
    expect(renderDoctor(reports)).toContain("stripe");
  });

  it("marks a provider connected once all keys are present", async () => {
    const s = freshSecrets();
    await s.set(secretKey("stripe", "secret"), "sk_test_x");
    await s.set(secretKey("stripe", "publishable"), "pk_test_x");
    const reports = await doctor(s);
    const stripe = reports.find((r) => r.provider === "stripe")!;
    expect(stripe.missing).toHaveLength(0);
    expect(renderDoctor(reports)).toContain("connected");
  });

  it("--ping calls the provider and reports OK/FAIL", async () => {
    const s = freshSecrets();
    await s.set(secretKey("stripe", "secret"), "sk_test_x");
    const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as FetchImpl;
    const reps = await doctor(s, { ping: true, fetch: okFetch });
    expect(reps.find((r) => r.provider === "stripe")!.ping?.ok).toBe(true);

    const badFetch = (async () => new Response("nope", { status: 401 })) as unknown as FetchImpl;
    const reps2 = await doctor(s, { ping: true, fetch: badFetch });
    expect(reps2.find((r) => r.provider === "stripe")!.ping?.ok).toBe(false);
  });

  it("skips ping when the auth key is absent", async () => {
    const reps = await doctor(freshSecrets(), { ping: true });
    expect(reps.every((r) => r.ping === undefined)).toBe(true);
  });
});
