import type { Clock } from "../util/clock.js";
import type { Store } from "../store/store.js";
import { applyVerification, recomputeLedger } from "../domain/apply.js";

/**
 * `pl decay` — re-evaluate every registered assumption against the current time.
 * applyVerification flips assumptions whose verified evidence has passed its
 * expiry to `decayed`; recomputeLedger then re-locks the gate if the gating node
 * decayed. "We validated this last quarter" must not grant forever-access.
 */
export function runDecay(store: Store, clock: Clock): void {
  const ledger = store.readLedger();
  if (!ledger.activeHypothesisId) return;
  const h = store.readHypothesis(ledger.activeHypothesisId);
  for (const a of h.assumptions) {
    if (a.activeRegistrationId) applyVerification(store, h, a.id, clock);
  }
  recomputeLedger(store, clock);
}
