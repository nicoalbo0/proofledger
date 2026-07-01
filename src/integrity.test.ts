import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./store/store.js";
import { fixedClock } from "./util/clock.js";
import { initRepo } from "./commands/init.js";
import { addHypothesis } from "./commands/hypothesis.js";
import { registerBet } from "./commands/register.js";
import { verifyStub } from "./commands/verify.js";
import { applyVerification, recomputeLedger } from "./domain/apply.js";
import { gateCheck, recordOverride } from "./domain/gate.js";
import { gatingAssumption } from "./domain/verdict.js";
import { assertIntact, isRegistrationIntact, RegistrationTamperError } from "./domain/integrity.js";
import type { Evidence } from "./domain/types.js";

const clock = fixedClock("2026-07-01T00:00:00.000Z");
let root: string;
let store: Store;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pl-int-"));
  store = new Store(root);
  initRepo(store, "test", clock);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Register the gating (pay) assumption with a clear-cut bet. */
function registerGate() {
  const h = addHypothesis(store, "users will pre-pay $15/mo for X", clock);
  const gate = gatingAssumption(h)!;
  registerBet(
    store,
    {
      assumptionId: gate.id,
      metric: "preauth_conversion",
      sampleTarget: 300,
      passIf: { op: ">=", value: 0.1 },
      killIf: { op: "<", value: 0.05 },
    },
    clock,
  );
  return gate.id;
}

describe("F4 — end-to-end: locked until real money", () => {
  it("gate is locked after init and after hypothesis", () => {
    expect(store.readLedger().gate.state).toBe("locked");
    registerGate();
    expect(store.readLedger().gate.state).toBe("locked");
    expect(gateCheck(store, "src/app.ts").decision).toBe("block");
    expect(gateCheck(store, "README.md").decision).toBe("allow"); // not product code
  });

  it("verified tier-2 evidence clearing the bet opens the gate", () => {
    const gateId = registerGate();
    verifyStub(store, [{ assumptionId: gateId, tier: 2, type: "stripe_preauth", clicks: 300, successes: 60 }], clock);
    expect(store.readLedger().gate.state).toBe("open");
    expect(gateCheck(store, "src/app.ts").decision).toBe("allow");
    expect(store.readLedger().verdicts[store.readLedger().activeHypothesisId!]!.verdict).toBe("SHARPEN");
  });
});

describe("F2 — cannot type past the gate", () => {
  it("PROVIDED (not verified) evidence never counts", () => {
    const gateId = registerGate();
    const h = store.readHypothesis(store.readLedger().activeHypothesisId!);
    // Hand-write 100 'provided' rows — the founder claiming success without proof.
    const base: Omit<Evidence, "id"> = {
      experimentId: "x_fake", assumptionId: gateId, tier: 2, type: "stripe_preauth",
      status: "provided", value: 1, source: { system: "stripe" },
      fetchedAt: clock.iso(), expiresAt: "2027-01-01T00:00:00.000Z",
    };
    for (let i = 0; i < 100; i++) store.writeEvidence({ ...base, id: `e_prov_${i}` });
    applyVerification(store, h, gateId, clock);
    recomputeLedger(store, clock);
    expect(store.readHypothesis(h.id).assumptions.find((a) => a.gate)!.status).toBe("untested");
    expect(store.readLedger().gate.state).toBe("locked");
  });

  it("VERIFIED but below minTier cannot grant alive (tier gate)", () => {
    const gateId = registerGate(); // gate node minTier = 2
    // 60/300 clears the proportion, but only tier-1 evidence -> inconclusive.
    verifyStub(store, [{ assumptionId: gateId, tier: 1, type: "email_capture", clicks: 300, successes: 60 }], clock);
    const g = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions.find((a) => a.gate)!;
    expect(g.status).toBe("inconclusive");
    expect(store.readLedger().gate.state).toBe("locked");
  });
});

describe("F3 — hash-lock tamper detection", () => {
  it("editing a frozen registration on disk is detected", () => {
    const gateId = registerGate();
    const regId = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions.find((a) => a.id === gateId)!.activeRegistrationId!;
    const file = join(root, ".proofledger", "registrations", `${regId}.json`);
    const reg = JSON.parse(readFileSync(file, "utf8"));
    expect(isRegistrationIntact(reg)).toBe(true);
    reg.passIf.value = 0.001; // move the goalposts
    writeFileSync(file, JSON.stringify(reg));
    const tampered = store.readRegistration(regId);
    expect(isRegistrationIntact(tampered)).toBe(false);
    expect(() => assertIntact(tampered)).toThrow(RegistrationTamperError);
  });
});

describe("F1 — only the sanctioned writers change authoritative state", () => {
  it("gate override records audit + does not touch assumption status", () => {
    const gateId = registerGate();
    const before = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions.find((a) => a.id === gateId)!.status;
    recordOverride(store, "founder insists", "nico", clock);
    const after = store.readHypothesis(store.readLedger().activeHypothesisId!).assumptions.find((a) => a.id === gateId)!.status;
    expect(after).toBe(before); // status untouched by override
    const audit = readFileSync(join(root, ".proofledger", "audit.log"), "utf8");
    expect(audit).toContain("gate_override");
    expect(store.readLedger().gate.overrides).toHaveLength(1);
  });
});
