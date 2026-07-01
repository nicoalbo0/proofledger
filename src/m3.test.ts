import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./store/store.js";
import { fixedClock } from "./util/clock.js";
import { initRepo } from "./commands/init.js";
import { addHypothesis } from "./commands/hypothesis.js";
import { registerBet } from "./commands/register.js";
import { runSignalScreen } from "./commands/signal.js";
import { FakeSignalAdapter } from "./adapters/signal.js";
import { logScore, scoreSignals } from "./domain/signal.js";
import { renderLanding } from "./domain/landing.js";

const T0 = fixedClock("2026-07-01T00:00:00.000Z");

describe("signal scoring", () => {
  it("logScore caps at the cap and floors at 0", () => {
    expect(logScore(0, 100)).toBe(0);
    expect(logScore(100, 100)).toBeCloseTo(100, 6);
    expect(logScore(5, 100)).toBeGreaterThan(0);
  });

  it("strong demand + low competition scores high, no red ocean", () => {
    const s = scoreSignals({ demandCount: 400, momentumCount: 50, competitorCount: 2, relevanceRatio: 1 });
    expect(s.redOcean).toBe(false);
    expect(s.final).toBeGreaterThan(70);
  });

  it("red-ocean penalty halves a crowded market", () => {
    const s = scoreSignals({ demandCount: 400, momentumCount: 50, competitorCount: 5000, relevanceRatio: 1 });
    expect(s.redOcean).toBe(true);
    expect(s.competitionFit).toBeLessThan(30);
    expect(s.final).toBeLessThan(30);
  });

  it("relevance penalty discounts off-keyword demand", () => {
    const hi = scoreSignals({ demandCount: 400, momentumCount: 50, competitorCount: 2, relevanceRatio: 1 });
    const lo = scoreSignals({ demandCount: 400, momentumCount: 50, competitorCount: 2, relevanceRatio: 0.2 });
    expect(lo.demand).toBeLessThan(hi.demand);
    expect(lo.final).toBeLessThan(hi.final);
  });
});

describe("runSignalScreen — Tier-0 can kill free, never opens gate", () => {
  let root: string, store: Store, demandId: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pl-m3-"));
    store = new Store(root);
    initRepo(store, "t", T0);
    const h = addHypothesis(store, "users will pay for X", T0);
    demandId = h.assumptions[0]!.id; // "demand exists", non-gate, minTier 1
    registerBet(store, { assumptionId: demandId, metric: "signal_score", sampleTarget: 1, passIf: { op: ">=", value: 70 }, killIf: { op: "<", value: 30 } }, T0);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("weak signal marks the assumption DEAD ($0 kill)", async () => {
    const weak = new FakeSignalAdapter({ demandCount: 3, momentumCount: 1, competitorCount: 5000, relevanceRatio: 0.3 });
    await runSignalScreen(store, weak, { assumptionId: demandId, query: { keywords: ["x"], competitorKeywords: ["y"] } }, T0);
    const a = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions[0]!;
    expect(a.status).toBe("dead");
  });

  it("strong signal cannot mark alive (tier 0 < minTier) -> inconclusive, gate stays locked", async () => {
    const strong = new FakeSignalAdapter({ demandCount: 400, momentumCount: 50, competitorCount: 2, relevanceRatio: 1 });
    await runSignalScreen(store, strong, { assumptionId: demandId, query: { keywords: ["x"], competitorKeywords: ["y"] } }, T0);
    const a = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions[0]!;
    expect(a.status).toBe("inconclusive");
    expect(store.readLedger().gate.state).toBe("locked");
  });
});

describe("renderLanding", () => {
  it("includes headline, price, tag, disclosure, publishable key; escapes html", () => {
    const html = renderLanding({
      headline: "Meal plans for <diabetics>",
      subhead: "sub",
      priceUsd: 15,
      ctaLabel: "Reserve",
      experimentTag: "x_1",
      stripePublishableKey: "pk_test_123",
      clientSecret: "cs_123",
    });
    expect(html).toContain("$15/mo");
    expect(html).toContain('content="x_1"');
    expect(html).toContain("pk_test_123");
    expect(html).toContain("NOT charged");
    expect(html).toContain("Meal plans for &lt;diabetics&gt;"); // escaped
  });
});
