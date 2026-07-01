import type { RawPreauth } from "../adapters/payment.js";

export interface FilterResult {
  countable: RawPreauth[];
  rejected: { intentId: string; reason: string }[];
}

/**
 * The anti-cheat core (invariant #4, data-model §4). Given the pre-auths
 * re-fetched from the provider, decide which actually count as verified
 * intent-to-pay:
 *
 *  - must be in `requires_capture` (a real, still-live authorization hold)
 *  - must carry OUR experiment tag (proves it came from the page we deployed)
 *  - one physical card counts once (dedupe by fingerprint) — stops a founder
 *    padding demand by re-entering the same card
 *
 * Pure function: no I/O, fully unit-testable with crafted inputs.
 */
export function filterCountablePreauths(
  raws: RawPreauth[],
  experimentTag: string,
): FilterResult {
  const countable: RawPreauth[] = [];
  const rejected: { intentId: string; reason: string }[] = [];
  const seenCards = new Set<string>();

  for (const r of raws) {
    if (r.state !== "requires_capture") {
      rejected.push({ intentId: r.intentId, reason: `state=${r.state}` });
      continue;
    }
    if (r.experimentTag !== experimentTag) {
      rejected.push({ intentId: r.intentId, reason: "tag mismatch" });
      continue;
    }
    if (r.cardFingerprint === null) {
      // No fingerprint = cannot prove it is a distinct card; do not trust it.
      rejected.push({ intentId: r.intentId, reason: "no card fingerprint" });
      continue;
    }
    if (seenCards.has(r.cardFingerprint)) {
      rejected.push({ intentId: r.intentId, reason: "duplicate card" });
      continue;
    }
    seenCards.add(r.cardFingerprint);
    countable.push(r);
  }

  return { countable, rejected };
}
