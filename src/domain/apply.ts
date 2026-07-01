import type { Clock } from "../util/clock.js";
import type { Store } from "../store/store.js";
import { renderLedgerMd } from "../store/render.js";
import { assertIntact } from "./integrity.js";
import { evaluate } from "./stats.js";
import { computeVerdict, gatingAssumption } from "./verdict.js";
import type {
  Assumption,
  AssumptionStatus,
  Evidence,
  Hypothesis,
} from "./types.js";

/**
 * applyVerification is the ONE AND ONLY writer of Assumption.status
 * (invariant #1, data-model §4). No other module — and no LLM — may set status.
 * It derives an observation strictly from VERIFIED, non-expired evidence, runs
 * the frozen registration through the Wilson evaluator, and enforces the
 * tier-gate: an assumption can only go `alive` on evidence at tier >= minTier.
 *
 * Returns the new status. Persists the mutated hypothesis and appends an audit
 * event when the status changes. Caller should follow with recomputeLedger().
 */
export function applyVerification(
  store: Store,
  hypothesis: Hypothesis,
  assumptionId: string,
  clock: Clock,
): AssumptionStatus {
  const a = hypothesis.assumptions.find((x) => x.id === assumptionId);
  if (!a) throw new Error(`assumption ${assumptionId} not found`);

  const prev = a.status;
  const { status, note } = deriveStatus(store, a, clock);

  a.status = status;
  a.note = note;
  store.writeHypothesis(hypothesis);

  if (status !== prev) {
    store.appendAudit({
      t: clock.iso(),
      kind: "status",
      assumptionId,
      from: prev,
      to: status,
      cause: note,
    });
  }
  return status;
}

function deriveStatus(
  store: Store,
  a: Assumption,
  clock: Clock,
): { status: AssumptionStatus; note: string } {
  if (!a.activeRegistrationId) {
    return { status: "untested", note: "no registration" };
  }
  const reg = store.readRegistration(a.activeRegistrationId);
  assertIntact(reg); // throws on tamper -> caller quarantines + hard-locks

  const verified = store
    .listEvidenceFor(a.id)
    .filter((e) => e.status === "verified");

  if (verified.length === 0) {
    return { status: "untested", note: "no verified evidence" };
  }

  const now = clock.now().getTime();
  const fresh = verified.filter((e) => new Date(e.expiresAt).getTime() > now);
  if (fresh.length === 0) {
    return { status: "decayed", note: "all verified evidence expired" };
  }

  // Denominator (trials) comes from experiment counters; inflating it only
  // LOWERS the proportion (harder to pass), so it cannot open the gate.
  // Numerator (successes) is the count of verified evidence rows — forging that
  // requires the verifier, which the founder does not control.
  const { k, n } = observe(store, a, fresh);
  const outcome = evaluate(k, n, reg);

  // Tier gate: only evidence at tier >= minTier may grant `alive`.
  const maxTier = fresh.reduce((m, e) => Math.max(m, e.tier), 0);
  if (outcome.outcome === "alive" && maxTier < a.minTier) {
    return {
      status: "inconclusive",
      note: `${outcome.note}; needs tier>=${a.minTier} evidence (have ${maxTier})`,
    };
  }
  return { status: outcome.outcome, note: outcome.note };
}

/** Successes k = verified evidence count; trials n from experiment counters. */
function observe(
  store: Store,
  a: Assumption,
  fresh: Evidence[],
): { k: number; n: number } {
  const reg = store.readRegistration(a.activeRegistrationId!);
  if (reg.metric === "signal_score") {
    // Tier-0 desk signal: a single evidence row carries the 0-100 score.
    const score = fresh[0]?.value ?? 0;
    return { k: score, n: 0 };
  }
  const k = fresh.length;
  const trials = store
    .listExperimentsFor(a.id)
    .reduce((sum, x) => sum + (x.counters.clicks ?? 0), 0);
  return { k, n: Math.max(trials, k) };
}

/**
 * Recompute the ledger's gate + verdicts from current assumption statuses and
 * re-render ledger.md. The gate is the second (and only other) place a derived
 * "authoritative" flag is written — gate.state.
 */
export function recomputeLedger(store: Store, clock: Clock): void {
  const ledger = store.readLedger();
  const hypotheses = store.listHypotheses();

  for (const h of hypotheses) {
    const verdict = computeVerdict(h);
    ledger.verdicts[h.id] = {
      verdict,
      computedAt: clock.iso(),
      explanation: ledger.verdicts[h.id]?.explanation ?? "",
    };
  }

  const active = hypotheses.find((h) => h.id === ledger.activeHypothesisId);
  const g = active ? gatingAssumption(active) : undefined;
  const open = g?.status === "alive";
  ledger.gate = {
    ...ledger.gate,
    state: open ? "open" : "locked",
    gatingAssumptionId: g?.id ?? null,
    reason: open
      ? `gating assumption "${g?.text}" is alive`
      : g
        ? `gating assumption "${g.text}" is ${g.status}`
        : "no active hypothesis",
    lastEvaluatedAt: clock.iso(),
  };

  store.writeLedger(ledger);
  store.writeLedgerMd(renderLedgerMd(ledger, hypotheses));
}
