import type { Clock } from "../util/clock.js";
import type { Store } from "../store/store.js";
import { matchesAny } from "./glob.js";

export interface GateDecision {
  decision: "allow" | "block";
  reason: string;
}

/**
 * The build-gate decision for a single Write/Edit at `path`. Pure read of
 * config.productGlobs + ledger.gate.state (which recomputeLedger keeps current).
 *
 * - path outside productGlobs      -> ALLOW (not product code)
 * - gate open (gating alive)       -> ALLOW
 * - otherwise                      -> BLOCK
 */
export function gateCheck(store: Store, path: string): GateDecision {
  const config = store.readConfig();
  if (!matchesAny(path, config.productGlobs)) {
    return { decision: "allow", reason: "path is not gated product code" };
  }
  const ledger = store.readLedger();
  if (ledger.gate.state === "open") {
    return { decision: "allow", reason: ledger.gate.reason };
  }
  return {
    decision: "block",
    reason: `build gate locked: ${ledger.gate.reason}. Run \`pl status\` — gather verified evidence to unlock.`,
  };
}

/** Record an explicit founder override (always audited + surfaced in export). */
export function recordOverride(
  store: Store,
  reason: string,
  by: string,
  clock: Clock,
): void {
  const ledger = store.readLedger();
  ledger.gate.overrides.push({ at: clock.iso(), reason, by });
  store.writeLedger(ledger);
  store.appendAudit({ t: clock.iso(), kind: "gate_override", reason, by });
}
