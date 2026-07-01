import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./store/store.js";
import { fixedClock } from "./util/clock.js";
import { initRepo } from "./commands/init.js";
import { addHypothesis } from "./commands/hypothesis.js";
import { registerBet } from "./commands/register.js";
import { BudgetExceededError, pollExperiment, runExperiment, type ExperimentOpts } from "./commands/experiment.js";
import { runPaymentVerification } from "./commands/verify-payment.js";
import { FakePaymentAdapter } from "./adapters/fake-payment.js";
import { FakeHostAdapter } from "./adapters/host.js";
import { FakeAdAdapter } from "./adapters/ad.js";
import { gatingAssumption } from "./domain/verdict.js";
import type { RawPreauth } from "./adapters/payment.js";

const T0 = fixedClock("2026-07-01T00:00:00.000Z");

function deps() {
  return { payment: new FakePaymentAdapter(), host: new FakeHostAdapter(), ad: new FakeAdAdapter() };
}
function opts(over: Partial<ExperimentOpts> = {}): ExperimentOpts {
  return {
    assumptionId: "SET",
    priceUsd: 15,
    stripePublishableKey: "pk_test",
    headline: "H",
    subhead: "S",
    ctaLabel: "Reserve",
    targeting: { keywords: ["x"], dailyBudgetUsd: 20, days: 5 }, // $100 <= cap $200
    ...over,
  };
}

describe("runExperiment saga", () => {
  let root: string, store: Store, gateId: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pl-m4-"));
    store = new Store(root);
    initRepo(store, "t", T0);
    const h = addHypothesis(store, "users will pre-pay $15/mo", T0);
    gateId = gatingAssumption(h)!.id;
    registerBet(store, { assumptionId: gateId, metric: "preauth_conversion", sampleTarget: 300, passIf: { op: ">=", value: 0.1 }, killIf: { op: "<", value: 0.05 } }, T0);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("deploys landing + creates PAUSED campaign; does not spend without confirm", async () => {
    const d = deps();
    const res = await runExperiment(store, d, opts({ assumptionId: gateId }), T0);
    expect(res.publicUrl).toContain(".fake.pages.dev");
    expect(res.activated).toBe(false);
    expect(d.ad.active.size).toBe(0); // not spending
    expect(d.host.deployed).toHaveLength(1);
  });

  it("is idempotent: re-run reconciles, no duplicate deploy/campaign", async () => {
    const d = deps();
    const a = await runExperiment(store, d, opts({ assumptionId: gateId }), T0);
    const b = await runExperiment(store, d, opts({ assumptionId: gateId }), T0);
    expect(b.experimentId).toBe(a.experimentId);
    expect(b.campaignId).toBe(a.campaignId);
    expect(d.host.deployed).toHaveLength(1); // still one
  });

  it("rejects a plan over the budget cap", async () => {
    await expect(
      runExperiment(store, deps(), opts({ assumptionId: gateId, targeting: { keywords: ["x"], dailyBudgetUsd: 20, days: 20 } }), T0),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("activation is opt-in and audited", async () => {
    const d = deps();
    const res = await runExperiment(store, d, opts({ assumptionId: gateId, confirmActivation: true }), T0);
    expect(res.activated).toBe(true);
    expect(d.ad.active.has(res.campaignId)).toBe(true);
  });

  it("FULL LOOP: run -> poll -> verify money -> gate opens", async () => {
    const d = deps();
    const res = await runExperiment(store, d, opts({ assumptionId: gateId, confirmActivation: true }), T0);

    d.ad.seedInsights({ clicks: 300, spendUsd: 100 });
    await pollExperiment(store, d.ad, res.experimentId, T0);

    const holds: RawPreauth[] = [];
    for (let i = 0; i < 60; i++) holds.push({ intentId: `pi_${i}`, state: "requires_capture", amountCents: 1500, currency: "usd", cardFingerprint: `c${i}`, experimentTag: res.experimentId });
    d.payment.seed(holds);

    await runPaymentVerification(store, d.payment, { experimentId: res.experimentId }, T0);

    expect(store.readLedger().gate.state).toBe("open");
    const g = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions.find((a) => a.gate)!;
    expect(g.status).toBe("alive");
    expect(g.note).toContain("n=300");
  });
});
