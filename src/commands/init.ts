import type { Clock } from "../util/clock.js";
import { Store } from "../store/store.js";
import type { Config, Ledger } from "../domain/types.js";

export function defaultConfig(): Config {
  return {
    version: 1,
    productGlobs: ["src/**", "app/**", "lib/**"],
    budget: { perExperimentUsdCap: 200, requireActivationConfirm: true },
    decayHalfLifeDays: 90,
    providers: { signal: "public" },
    verdictLlm: { provider: "anthropic", model: "claude-opus-4-8" },
  };
}

function emptyLedger(clock: Clock): Ledger {
  return {
    version: 1,
    activeHypothesisId: null,
    gate: {
      state: "locked",
      reason: "no active hypothesis",
      gatingAssumptionId: null,
      lastEvaluatedAt: clock.iso(),
      overrides: [],
    },
    verdicts: {},
  };
}

export interface InitResult {
  alreadyInitialized: boolean;
}

/** `proofledger init` — scaffold .proofledger/, write default config + empty ledger. */
export function initRepo(store: Store, motivation: string, clock: Clock): InitResult {
  if (store.isInitialized()) return { alreadyInitialized: true };
  store.scaffold();
  store.writeConfig(defaultConfig());
  const ledger = emptyLedger(clock);
  store.writeLedger(ledger);
  store.appendAudit({ t: clock.iso(), kind: "init", motivation });
  return { alreadyInitialized: false };
}
