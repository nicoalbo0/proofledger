import type { Clock } from "../util/clock.js";
import type { Store } from "../store/store.js";
import { newId } from "../util/id.js";
import { recomputeLedger } from "../domain/apply.js";
import type { Assumption, Hypothesis } from "../domain/types.js";

/**
 * Decompose a claim into risky assumptions. M1 uses a fixed, honest skeleton
 * (the four bets every "someone pays for X" claim rests on) so the flow works
 * fully offline. B2's LLM path will replace this with a tailored decomposition;
 * the contract (exactly one gate node, gate node minTier=2) stays identical.
 */
export function decompose(): Omit<Assumption, "id">[] {
  return [
    { text: "the problem is real / demand exists", critical: false, gate: false, status: "untested", minTier: 1 },
    { text: "customers will pay the target price", critical: true, gate: true, status: "untested", minTier: 2 },
    { text: "customers are acquirable below price", critical: true, gate: false, status: "untested", minTier: 1 },
    { text: "customers retain long enough to be profitable", critical: true, gate: false, status: "untested", minTier: 1 },
  ];
}

export function buildHypothesis(claim: string, clock: Clock): Hypothesis {
  const skeleton = decompose();
  const gateCount = skeleton.filter((a) => a.gate).length;
  if (gateCount !== 1) {
    throw new Error(`decompose must mark exactly one gate node, got ${gateCount}`);
  }
  return {
    id: newId("h"),
    claim,
    createdAt: clock.iso(),
    status: "active",
    assumptions: skeleton.map((a) => ({ ...a, id: newId("a") })),
  };
}

/** `pl hypothesis "<claim>"` — create + activate a hypothesis, recompute gate. */
export function addHypothesis(store: Store, claim: string, clock: Clock): Hypothesis {
  const h = buildHypothesis(claim, clock);
  store.writeHypothesis(h);

  const ledger = store.readLedger();
  ledger.activeHypothesisId = h.id;
  store.writeLedger(ledger);

  recomputeLedger(store, clock); // gate locks on the fresh untested gate node
  return h;
}
