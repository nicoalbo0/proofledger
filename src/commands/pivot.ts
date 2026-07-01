import type { Clock } from "../util/clock.js";
import type { Store } from "../store/store.js";
import { addHypothesis } from "./hypothesis.js";
import { recomputeLedger } from "../domain/apply.js";
import type { Hypothesis } from "../domain/types.js";

export interface PivotResult {
  archived: string | null;
  created: Hypothesis | null;
}

/**
 * `proofledger pivot` — archive the active hypothesis (a dead bet is history, not deleted)
 * and optionally seed a new one. The build gate re-locks: a fresh hypothesis is
 * untested, and no active hypothesis means nothing to gate on.
 */
export function pivot(store: Store, newClaim: string | undefined, clock: Clock): PivotResult {
  const ledger = store.readLedger();
  let archived: string | null = null;

  if (ledger.activeHypothesisId) {
    const h = store.readHypothesis(ledger.activeHypothesisId);
    h.status = "archived";
    store.writeHypothesis(h);
    archived = h.id;
    ledger.activeHypothesisId = null;
    store.writeLedger(ledger);
    store.appendAudit({ t: clock.iso(), kind: "pivot", archived: h.id });
  }

  let created: Hypothesis | null = null;
  if (newClaim) {
    created = addHypothesis(store, newClaim, clock); // sets active + recomputes
  } else {
    recomputeLedger(store, clock); // gate -> "no active hypothesis"
  }

  return { archived, created };
}
