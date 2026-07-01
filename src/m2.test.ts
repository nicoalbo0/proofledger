import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./store/store.js";
import { fixedClock } from "./util/clock.js";
import { initRepo } from "./commands/init.js";
import { addHypothesis } from "./commands/hypothesis.js";
import { registerBet } from "./commands/register.js";
import { runDecay } from "./commands/decay.js";
import { runPaymentVerification } from "./commands/verify-payment.js";
import { filterCountablePreauths } from "./domain/verify-core.js";
import { mapIntentToRawPreauth } from "./adapters/stripe.js";
import { FakePaymentAdapter } from "./adapters/fake-payment.js";
import { gatingAssumption } from "./domain/verdict.js";
import type { RawPreauth } from "./adapters/payment.js";

const T0 = fixedClock("2026-07-01T00:00:00.000Z");

function preauth(over: Partial<RawPreauth>): RawPreauth {
  return { intentId: "pi_x", state: "requires_capture", amountCents: 1500, currency: "usd", cardFingerprint: "fp", experimentTag: "TAG", ...over };
}

describe("filterCountablePreauths (anti-cheat core)", () => {
  it("keeps distinct requires_capture holds with our tag", () => {
    const raws = [preauth({ intentId: "a", cardFingerprint: "c1" }), preauth({ intentId: "b", cardFingerprint: "c2" })];
    const r = filterCountablePreauths(raws, "TAG");
    expect(r.countable.map((p) => p.intentId)).toEqual(["a", "b"]);
  });
  it("rejects wrong state, wrong tag, null fingerprint, and duplicate cards", () => {
    const raws = [
      preauth({ intentId: "ok", cardFingerprint: "c1" }),
      preauth({ intentId: "captured", state: "succeeded", cardFingerprint: "c9" }),
      preauth({ intentId: "othertag", experimentTag: "NOPE", cardFingerprint: "c8" }),
      preauth({ intentId: "nofp", cardFingerprint: null }),
      preauth({ intentId: "dupe", cardFingerprint: "c1" }),
    ];
    const r = filterCountablePreauths(raws, "TAG");
    expect(r.countable.map((p) => p.intentId)).toEqual(["ok"]);
    expect(r.rejected).toHaveLength(4);
  });
});

describe("mapIntentToRawPreauth", () => {
  it("maps status, tag, and card fingerprint", () => {
    const raw = mapIntentToRawPreauth({
      id: "pi_1", status: "requires_capture", amount: 1500, currency: "usd",
      metadata: { pl_experiment: "x_1" },
      latest_charge: { payment_method_details: { card: { fingerprint: "fp_abc" } } },
    });
    expect(raw).toMatchObject({ intentId: "pi_1", state: "requires_capture", experimentTag: "x_1", cardFingerprint: "fp_abc" });
  });
  it("defaults missing tag/fingerprint to null", () => {
    const raw = mapIntentToRawPreauth({ id: "pi_2", status: "requires_capture", amount: 1500, currency: "usd" });
    expect(raw.experimentTag).toBeNull();
    expect(raw.cardFingerprint).toBeNull();
  });
});

describe("runPaymentVerification — real path, gate opens on verified money", () => {
  let root: string, store: Store, gateId: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pl-m2-"));
    store = new Store(root);
    initRepo(store, "t", T0);
    const h = addHypothesis(store, "users will pre-pay $15/mo", T0);
    gateId = gatingAssumption(h)!.id;
    registerBet(store, { assumptionId: gateId, metric: "preauth_conversion", sampleTarget: 300, passIf: { op: ">=", value: 0.1 }, killIf: { op: "<", value: 0.05 } }, T0);
    store.writeExperiment({
      id: "x_pay", assumptionId: gateId, registrationId: "", tier: 2, status: "running",
      providerRefs: { stripeMetadataTag: "x_pay" }, counters: { clicks: 300 },
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("counts 60 distinct cards -> alive, gate open, holds voided", async () => {
    const holds: RawPreauth[] = [];
    for (let i = 0; i < 60; i++) holds.push(preauth({ intentId: `pi_${i}`, cardFingerprint: `card_${i}`, experimentTag: "x_pay" }));
    holds.push(preauth({ intentId: "pi_dupe", cardFingerprint: "card_0", experimentTag: "x_pay" })); // padding attempt
    const adapter = new FakePaymentAdapter(holds);

    const res = await runPaymentVerification(store, adapter, { experimentId: "x_pay" }, T0);

    expect(res.counted).toBe(60); // dupe rejected
    expect(res.voided).toHaveLength(60); // holds released, not charged
    expect(adapter.voided).toHaveLength(60);
    expect(store.readLedger().gate.state).toBe("open");
    const g = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions.find((a) => a.gate)!;
    expect(g.status).toBe("alive");
  });

  it("decay past expiry re-locks the gate", async () => {
    const holds: RawPreauth[] = [];
    for (let i = 0; i < 60; i++) holds.push(preauth({ intentId: `pi_${i}`, cardFingerprint: `card_${i}`, experimentTag: "x_pay" }));
    await runPaymentVerification(store, new FakePaymentAdapter(holds), { experimentId: "x_pay" }, T0);
    expect(store.readLedger().gate.state).toBe("open");

    const later = fixedClock("2026-11-01T00:00:00.000Z"); // > 90d default half-life
    runDecay(store, later);
    const g = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions.find((a) => a.gate)!;
    expect(g.status).toBe("decayed");
    expect(store.readLedger().gate.state).toBe("locked");
  });
});
