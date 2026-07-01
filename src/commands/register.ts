import type { Clock } from "../util/clock.js";
import type { Store } from "../store/store.js";
import { freezeRegistration, type FreezeInput } from "../domain/register.js";
import { gatingAssumption } from "../domain/verdict.js";
import { recomputeLedger } from "../domain/apply.js";
import type { Registration } from "../domain/types.js";

export type RegisterInput = Omit<FreezeInput, "assumptionId"> & {
  assumptionId?: string; // defaults to the gating assumption
};

/** `proofledger register` — freeze a hash-locked bet on an assumption of the active hypothesis. */
export function registerBet(store: Store, input: RegisterInput, clock: Clock): Registration {
  const ledger = store.readLedger();
  if (!ledger.activeHypothesisId) throw new Error("no active hypothesis; run `proofledger hypothesis` first");
  const h = store.readHypothesis(ledger.activeHypothesisId);

  const assumptionId = input.assumptionId ?? gatingAssumption(h)?.id;
  if (!assumptionId) throw new Error("no assumption to register");
  const a = h.assumptions.find((x) => x.id === assumptionId);
  if (!a) throw new Error(`assumption ${assumptionId} not found`);

  const reg = freezeRegistration({ ...input, assumptionId }, clock);
  store.writeRegistration(reg);

  a.activeRegistrationId = reg.id;
  store.writeHypothesis(h);
  store.appendAudit({ t: clock.iso(), kind: "register", registrationId: reg.id, hash: reg.hash });

  recomputeLedger(store, clock);
  return reg;
}
