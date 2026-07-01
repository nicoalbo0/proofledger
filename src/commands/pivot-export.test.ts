import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../store/store.js";
import { fixedClock } from "../util/clock.js";
import { initRepo } from "./init.js";
import { addHypothesis } from "./hypothesis.js";
import { registerBet } from "./register.js";
import { verifyStub } from "./verify.js";
import { pivot } from "./pivot.js";
import { buildExport, verifiedCounts } from "./export.js";
import { gatingAssumption } from "../domain/verdict.js";

const T0 = fixedClock("2026-07-01T00:00:00.000Z");
let root: string, store: Store;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pl-pe-"));
  store = new Store(root);
  initRepo(store, "t", T0);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("pivot", () => {
  it("archives the active hypothesis and re-locks the gate", () => {
    const h = addHypothesis(store, "claim A", T0);
    const r = pivot(store, undefined, T0);
    expect(r.archived).toBe(h.id);
    expect(store.readHypothesis(h.id).status).toBe("archived");
    expect(store.readLedger().activeHypothesisId).toBeNull();
    expect(store.readLedger().gate.state).toBe("locked");
  });

  it("archives and seeds a new active hypothesis", () => {
    const a = addHypothesis(store, "claim A", T0);
    const r = pivot(store, "claim B", T0);
    expect(r.archived).toBe(a.id);
    expect(r.created?.claim).toBe("claim B");
    expect(store.readLedger().activeHypothesisId).toBe(r.created!.id);
  });
});

describe("buildExport", () => {
  it("shows verified evidence counts and surfaces gate overrides", () => {
    const h = addHypothesis(store, "users will pay", T0);
    const gate = gatingAssumption(h)!;
    registerBet(store, { assumptionId: gate.id, metric: "preauth_conversion", sampleTarget: 300, passIf: { op: ">=", value: 0.1 }, killIf: { op: "<", value: 0.05 } }, T0);
    verifyStub(store, [{ assumptionId: gate.id, tier: 2, type: "stripe_preauth", clicks: 300, successes: 60 }], T0);

    const ledger = store.readLedger();
    ledger.gate.overrides.push({ at: "2026-07-02T00:00:00Z", reason: "impatient", by: "nico" });

    const hyps = store.listHypotheses();
    const md = buildExport(ledger, hyps, verifiedCounts(store, hyps));
    expect(md).toContain("users will pay");
    expect(md).toContain("| 60 |"); // 60 verified pre-auths on the gate node
    expect(md).toContain("overridden 1 time");
    expect(md).toContain("impatient");
  });
});
