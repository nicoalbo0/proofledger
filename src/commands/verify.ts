import type { Clock } from "../util/clock.js";
import type { Store } from "../store/store.js";
import { newId } from "../util/id.js";
import { addDaysIso } from "../util/clock.js";
import { applyVerification, recomputeLedger } from "../domain/apply.js";
import type { Evidence, EvidenceTier, EvidenceType } from "../domain/types.js";

/**
 * M1 StubVerifier input. Simulates what a real adapter re-fetch would emit:
 * a batch of trials + verified successes for an assumption. Replaced in M2+ by
 * real Stripe/ad re-fetch — the applyVerification contract stays identical.
 */
export interface StubBatch {
  assumptionId: string;
  tier: EvidenceTier;
  type: EvidenceType;
  clicks?: number; // trials (denominator) for proportion metrics
  successes?: number; // number of verified success artifacts to emit
  score?: number; // for Tier-0 signal_score: the 0-100 desk score
}

/**
 * `pl verify` (M1 stub) — materialize verified evidence from a stub batch, then
 * run the sole status writer + recompute the gate. In M1 this stands in for real
 * provider re-fetch; every Evidence row is marked `verified` because the (stub)
 * verifier "re-fetched" it. Founder-typed numbers never reach status directly —
 * they must pass through here as evidence rows.
 */
export function verifyStub(store: Store, batches: StubBatch[], clock: Clock): void {
  const ledger = store.readLedger();
  if (!ledger.activeHypothesisId) throw new Error("no active hypothesis");
  const h = store.readHypothesis(ledger.activeHypothesisId);

  for (const b of batches) {
    const xId = newId("x");
    store.writeExperiment({
      id: xId,
      assumptionId: b.assumptionId,
      registrationId: h.assumptions.find((a) => a.id === b.assumptionId)?.activeRegistrationId ?? "",
      tier: b.tier,
      status: "closed",
      providerRefs: {},
      counters: { clicks: b.clicks ?? 0, polledAt: clock.iso() },
      closedAt: clock.iso(),
    });

    const expiresAt = addDaysIso(clock.iso(), store.readConfig().decayHalfLifeDays);
    const rows: number = b.type === "signal_desk" ? 1 : b.successes ?? 0;
    for (let i = 0; i < rows; i++) {
      const e: Evidence = {
        id: newId("e"),
        experimentId: xId,
        assumptionId: b.assumptionId,
        tier: b.tier,
        type: b.type,
        status: "verified",
        value: b.type === "signal_desk" ? (b.score ?? 0) : 1,
        source: { system: sourceFor(b.type), objectId: `stub_${i}` },
        fetchedAt: clock.iso(),
        expiresAt,
      };
      store.writeEvidence(e);
    }
    store.appendAudit({ t: clock.iso(), kind: "verify", experimentId: xId });
    applyVerification(store, h, b.assumptionId, clock);
  }

  recomputeLedger(store, clock);
}

function sourceFor(t: EvidenceType): Evidence["source"]["system"] {
  switch (t) {
    case "stripe_preauth":
    case "captured_sale":
      return "stripe";
    case "ad_conversion":
      return "meta";
    case "email_capture":
      return "survey";
    case "interview":
      return "transcript";
    case "signal_desk":
      return "public";
  }
}
