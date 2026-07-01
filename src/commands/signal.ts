import type { Clock } from "../util/clock.js";
import { addDaysIso } from "../util/clock.js";
import type { Store } from "../store/store.js";
import type { SignalAdapter, SignalQuery } from "../adapters/signal.js";
import { scoreSignals, type SignalScore } from "../domain/signal.js";
import { newId } from "../util/id.js";
import { applyVerification, recomputeLedger } from "../domain/apply.js";
import type { Evidence, Hypothesis } from "../domain/types.js";

/**
 * `pl signal` (Tier-0) — free desk screen. Computes a deterministic signal score
 * from public data and records it as a verified tier-0 `signal_desk` evidence.
 * Because tier 0 < any gate node's minTier, a strong score can never open the
 * build gate — but a weak score CAN mark the assumption `dead` (a $0 kill).
 *
 * The target assumption must first be registered with metric `signal_score`.
 */
export async function runSignalScreen(
  store: Store,
  adapter: SignalAdapter,
  opts: { assumptionId: string; query: SignalQuery },
  clock: Clock,
): Promise<SignalScore> {
  const h = findHypothesisFor(store, opts.assumptionId);
  const input = await adapter.fetchSignals(opts.query);
  const score = scoreSignals(input);

  const xId = newId("x");
  store.writeExperiment({
    id: xId,
    assumptionId: opts.assumptionId,
    registrationId:
      h.assumptions.find((a) => a.id === opts.assumptionId)?.activeRegistrationId ?? "",
    tier: 0,
    status: "closed",
    providerRefs: {},
    counters: { polledAt: clock.iso() },
    closedAt: clock.iso(),
  });

  const e: Evidence = {
    id: newId("e"),
    experimentId: xId,
    assumptionId: opts.assumptionId,
    tier: 0,
    type: "signal_desk",
    status: "verified", // deterministic function of public data
    value: score.final,
    source: { system: "public", state: score.redOcean ? "red_ocean" : "ok" },
    fetchedAt: clock.iso(),
    expiresAt: addDaysIso(clock.iso(), store.readConfig().decayHalfLifeDays),
  };
  store.writeEvidence(e);
  store.appendAudit({ t: clock.iso(), kind: "verify", experimentId: xId, tier: 0, score: score.final });

  applyVerification(store, h, opts.assumptionId, clock);
  recomputeLedger(store, clock);
  return score;
}

function findHypothesisFor(store: Store, assumptionId: string): Hypothesis {
  const h = store.listHypotheses().find((x) => x.assumptions.some((a) => a.id === assumptionId));
  if (!h) throw new Error(`no hypothesis owns assumption ${assumptionId}`);
  return h;
}
