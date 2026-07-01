import { describe, expect, it } from "vitest";
import { StripePaymentAdapter } from "./stripe.js";
import { filterCountablePreauths } from "../domain/verify-core.js";

// LIVE smoke test against Stripe TEST MODE. Skipped unless PL_LIVE_STRIPE is set
// to a test secret key (sk_test_...). No real money — test cards only.
//
//   PL_LIVE_STRIPE=sk_test_xxx npm run smoke:stripe
//
// Proves the real verification path end to end: create manual-capture intents,
// re-fetch them, dedupe by card fingerprint, and void the holds.

const KEY = process.env.PL_LIVE_STRIPE;

describe.skipIf(!KEY)("Stripe test-mode live smoke", () => {
  it("creates holds, dedupes by card, counts distinct, and voids", async () => {
    if (!KEY) return;
    if (!KEY.startsWith("sk_test_")) throw new Error("refusing to run: PL_LIVE_STRIPE must be a TEST key (sk_test_...)");

    interface StripeLike {
      paymentIntents: { create(args: Record<string, unknown>): Promise<{ id: string }> };
    }
    const StripeCtor = (await import("stripe" as string)).default as new (k: string) => StripeLike;
    const stripe = new StripeCtor(KEY);
    const tag = `pl_smoke_${Date.now()}`;

    // Helper: create + confirm a manual-capture intent with a test payment method.
    const hold = (pm: string) =>
      stripe.paymentIntents.create({
        amount: 1500,
        currency: "usd",
        capture_method: "manual",
        confirm: true,
        payment_method: pm,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: { pl_experiment: tag },
      });

    // Two Visas (same fingerprint = duplicate card) + one Mastercard (distinct).
    await hold("pm_card_visa");
    await hold("pm_card_visa");
    await hold("pm_card_mastercard");

    const adapter = new StripePaymentAdapter(KEY);
    const raws = await adapter.listPreauths(tag);
    expect(raws.length).toBeGreaterThanOrEqual(3);
    expect(raws.every((r) => r.state === "requires_capture")).toBe(true);
    expect(raws.every((r) => r.cardFingerprint !== null)).toBe(true);

    // The anti-cheat filter: 3 holds -> 2 countable (one Visa deduped).
    const { countable, rejected } = filterCountablePreauths(raws, tag);
    expect(countable).toHaveLength(2);
    expect(rejected.some((r) => r.reason === "duplicate card")).toBe(true);

    // Void every hold (signal, not a sale). Then confirm they are canceled.
    for (const r of raws) await adapter.voidPreauth(r.intentId);
    const after = await adapter.listPreauths(tag);
    expect(after.every((r) => r.state === "canceled")).toBe(true);
  }, 60_000);
});
