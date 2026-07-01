import type { Assumption, Hypothesis, Verdict } from "./types.js";

/** The single gating assumption (exactly one has gate=true). */
export function gatingAssumption(h: Hypothesis): Assumption | undefined {
  return h.assumptions.find((a) => a.gate);
}

/**
 * Mechanical verdict rollup — no LLM. See docs/data-model.md §3.4.
 * The explanation prose is attached elsewhere; this only picks the verdict.
 */
export function computeVerdict(h: Hypothesis): Verdict {
  const g = gatingAssumption(h);
  if (!g) return "PENDING";

  if (g.status === "untested" || g.status === "inconclusive" || g.status === "decayed") {
    return "PENDING";
  }

  const critical = h.assumptions.filter((a) => a.critical);
  const allCriticalAlive = critical.every((a) => a.status === "alive");
  const someNonCriticalDead = h.assumptions.some((a) => !a.critical && a.status === "dead");

  if (g.status === "alive") {
    return allCriticalAlive && !someNonCriticalDead ? "SHIP" : "SHARPEN";
  }

  // g.status === "dead": PIVOT if a cheaper variant is still worth trying,
  // else KILL. "Cheaper variant untried" is a product signal we don't model in
  // M1, so default to PIVOT (never silently KILL) unless every critical is dead.
  const allCriticalDead = critical.every((a) => a.status === "dead");
  return allCriticalDead ? "KILL" : "PIVOT";
}
