import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./store.js";
import { renderLedgerMd } from "./render.js";
import type { Hypothesis, Ledger } from "../domain/types.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pl-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function sampleHypothesis(): Hypothesis {
  return {
    id: "h_meal",
    claim: "diabetics will pre-pay $15/mo for AI meal planning",
    createdAt: "2026-07-01T00:00:00.000Z",
    status: "active",
    assumptions: [
      { id: "a_want", text: "demand exists", critical: false, gate: false, status: "alive", minTier: 1 },
      { id: "a_pay", text: "will pre-pay $15/mo", critical: true, gate: true, status: "dead", minTier: 2, note: "p̂=2.0% CI[0.9%,4.3%]" },
    ],
  };
}

describe("Store", () => {
  it("scaffolds and reports initialized after config write", () => {
    const s = new Store(root);
    expect(s.isInitialized()).toBe(false);
    s.scaffold();
    s.writeConfig({
      version: 1,
      productGlobs: ["src/**"],
      budget: { perExperimentUsdCap: 200, requireActivationConfirm: true },
      decayHalfLifeDays: 90,
      providers: { signal: "public" },
      verdictLlm: { provider: "anthropic", model: "claude-opus-4-8" },
    });
    expect(s.isInitialized()).toBe(true);
  });

  it("round-trips a hypothesis", () => {
    const s = new Store(root);
    s.scaffold();
    const h = sampleHypothesis();
    s.writeHypothesis(h);
    expect(s.readHypothesis("h_meal")).toEqual(h);
    expect(s.listHypotheses()).toHaveLength(1);
  });

  it("appends audit as JSONL", () => {
    const s = new Store(root);
    s.scaffold();
    s.appendAudit({ t: "2026-07-01T00:00:00Z", kind: "register", registrationId: "r_1" });
    s.appendAudit({ t: "2026-07-01T00:01:00Z", kind: "gate", decision: "block" });
    const raw = readFileSync(join(root, ".proofledger", "audit.log"), "utf8").trim().split("\n");
    expect(raw).toHaveLength(2);
    expect(JSON.parse(raw[1]!).decision).toBe("block");
  });

  it("filters evidence by assumption", () => {
    const s = new Store(root);
    s.scaffold();
    const base = { experimentId: "x1", tier: 2 as const, type: "stripe_preauth" as const, status: "verified" as const, value: 1, source: { system: "stripe" as const }, fetchedAt: "t", expiresAt: "t2" };
    s.writeEvidence({ id: "e1", assumptionId: "a_pay", ...base });
    s.writeEvidence({ id: "e2", assumptionId: "a_want", ...base });
    expect(s.listEvidenceFor("a_pay").map((e) => e.id)).toEqual(["e1"]);
  });
});

describe("renderLedgerMd", () => {
  it("renders gate state + assumption table", () => {
    const ledger: Ledger = {
      version: 1,
      activeHypothesisId: "h_meal",
      gate: { state: "locked", reason: "pay-assumption dead", gatingAssumptionId: "a_pay", lastEvaluatedAt: "t", overrides: [] },
      verdicts: { h_meal: { verdict: "PIVOT", computedAt: "t", explanation: "Price is dead; try $8." } },
    };
    const md = renderLedgerMd(ledger, [sampleHypothesis()]);
    expect(md).toContain("🔒 LOCKED");
    expect(md).toContain("Verdict: **PIVOT**");
    expect(md).toContain("will pre-pay $15/mo");
    expect(md).toContain("🔴 DEAD");
  });
});
