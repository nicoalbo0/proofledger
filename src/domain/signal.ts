// Tier-0 desk-signal scorer. Deterministic, no LLM — adapted from impact-compass:
// log-scaling so 5000 stars isn't 1000× a 5-star repo, a red-ocean saturation
// penalty so high demand in a crowded market can't score high, and a relevance
// penalty so off-keyword noise doesn't inflate demand. Pure + fully testable.
//
// A Tier-0 score can KILL a belief for $0 but NEVER opens the build gate — only
// verified money (tier >= 2) does that. See docs/technical-spec.md §11 ladder.

export interface SignalInput {
  /** Complaints / "I wish this existed" mentions (Reddit, HN, SO). */
  demandCount: number;
  /** Building activity in the space (GitHub repos, npm packages). */
  momentumCount: number;
  /** Existing competitors / substitutes found. */
  competitorCount: number;
  /** Fraction 0..1 of fetched results that actually match the target keywords. */
  relevanceRatio: number;
}

export interface SignalScore {
  demand: number; // 0..100
  momentum: number; // 0..100
  competitionFit: number; // 0..100 (high = uncrowded)
  redOcean: boolean;
  final: number; // 0..100
}

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

/** Log-scaled 0..100: diminishing returns, saturating near `cap`. */
export function logScore(count: number, cap: number): number {
  if (count <= 0) return 0;
  const s = Math.log10(count + 1) / Math.log10(cap + 1);
  return clamp(s * 100);
}

const WEIGHTS = { demand: 0.4, momentum: 0.2, competitionFit: 0.4 } as const;

export function scoreSignals(input: SignalInput): SignalScore {
  const relevance = clamp(input.relevanceRatio, 0, 1);
  // Relevance penalty: off-keyword demand is discounted directly.
  const demand = logScore(input.demandCount, 500) * relevance;
  const momentum = logScore(input.momentumCount, 1000);
  // More competitors => lower fit.
  const competitionFit = clamp(100 - logScore(input.competitorCount, 200));

  let final =
    demand * WEIGHTS.demand +
    momentum * WEIGHTS.momentum +
    competitionFit * WEIGHTS.competitionFit;

  // Red-ocean penalty: strong demand in a saturated market is a trap, not a win.
  const redOcean = demand > 70 && competitionFit < 30;
  if (redOcean) final *= 0.5;

  return {
    demand: round1(demand),
    momentum: round1(momentum),
    competitionFit: round1(competitionFit),
    redOcean,
    final: round1(clamp(final)),
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
