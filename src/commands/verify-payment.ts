import type { Clock } from "../util/clock.js";
import { addDaysIso } from "../util/clock.js";
import type { Store } from "../store/store.js";
import type { PaymentAdapter } from "../adapters/payment.js";
import { newId } from "../util/id.js";
import { filterCountablePreauths } from "../domain/verify-core.js";
import { applyVerification, recomputeLedger } from "../domain/apply.js";
import type { Evidence, Hypothesis } from "../domain/types.js";

export interface PaymentVerifyResult {
  counted: number;
  rejected: { intentId: string; reason: string }[];
  voided: string[];
}

/**
 * Real (M2) verification for a Stripe pre-auth experiment. Re-fetches holds from
 * the provider, keeps only genuinely countable ones (see filterCountablePreauths),
 * writes them as verified Evidence, voids the holds (signal, not a sale) unless
 * `capture` is opted in, then runs the sole status writer + recompute.
 *
 * Founder-typed numbers never enter here — only artifacts the adapter re-fetched.
 */
export async function runPaymentVerification(
  store: Store,
  adapter: PaymentAdapter,
  opts: { experimentId: string; capture?: boolean },
  clock: Clock,
): Promise<PaymentVerifyResult> {
  const exp = store.readExperiment(opts.experimentId);
  const tag = exp.providerRefs.stripeMetadataTag ?? exp.id;

  const raws = await adapter.listPreauths(tag);
  const { countable, rejected } = filterCountablePreauths(raws, tag);

  const expiresAt = addDaysIso(clock.iso(), store.readConfig().decayHalfLifeDays);
  for (const p of countable) {
    const e: Evidence = {
      id: newId("e"),
      experimentId: exp.id,
      assumptionId: exp.assumptionId,
      tier: 2,
      type: "stripe_preauth",
      status: "verified",
      value: 1,
      source: {
        system: "stripe",
        objectId: p.intentId,
        state: p.state,
        ...(p.cardFingerprint ? { fingerprint: p.cardFingerprint } : {}),
      },
      fetchedAt: clock.iso(),
      expiresAt,
    };
    store.writeEvidence(e);
  }

  exp.counters.preauths = countable.length;
  exp.counters.polledAt = clock.iso();
  exp.status = "closed";
  exp.closedAt = clock.iso();
  store.writeExperiment(exp);

  const voided: string[] = [];
  if (!opts.capture) {
    for (const p of countable) {
      await adapter.voidPreauth(p.intentId);
      voided.push(p.intentId);
    }
  }

  store.appendAudit({
    t: clock.iso(),
    kind: "verify",
    experimentId: exp.id,
    counted: countable.length,
    rejected: rejected.length,
    voided: voided.length,
  });

  const h = findHypothesisFor(store, exp.assumptionId);
  applyVerification(store, h, exp.assumptionId, clock);
  recomputeLedger(store, clock);

  return { counted: countable.length, rejected, voided };
}

function findHypothesisFor(store: Store, assumptionId: string): Hypothesis {
  const h = store
    .listHypotheses()
    .find((x) => x.assumptions.some((a) => a.id === assumptionId));
  if (!h) throw new Error(`no hypothesis owns assumption ${assumptionId}`);
  return h;
}
