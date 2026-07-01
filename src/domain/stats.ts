import type { Metric, Registration, Threshold } from "./types.js";

// Proportion metrics get a Wilson score interval; PASS/KILL are decided on the
// INTERVAL BOUND, not the point estimate — so a wide "6/300 = 2%" is never read
// as a clean result. See docs/technical-spec.md §11.2.
const PROPORTION_METRICS: ReadonlySet<Metric> = new Set<Metric>([
  "preauth_conversion",
  "email_conversion",
  "interview_yes_rate",
]);

export interface WilsonInterval {
  point: number;
  lower: number;
  upper: number;
}

/**
 * Inverse standard-normal CDF (Acklam's algorithm). Lets `confidence` be
 * configurable instead of hard-coding z=1.96. Accurate to ~1e-9 in (0,1).
 */
export function invNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`invNormalCdf domain: ${p}`);
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) *
        q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
}

/** Two-sided z for a confidence level, e.g. 0.95 -> ~1.95996. */
export function zForConfidence(confidence: number): number {
  return invNormalCdf(1 - (1 - confidence) / 2);
}

/** Wilson score interval for k successes in n trials at the given confidence. */
export function wilson(k: number, n: number, confidence = 0.95): WilsonInterval {
  if (n <= 0) return { point: 0, lower: 0, upper: 1 };
  const z = zForConfidence(confidence);
  const phat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin =
    (z / denom) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
  return {
    point: phat,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

function satisfies(x: number, t: Threshold): boolean {
  switch (t.op) {
    case ">=":
      return x >= t.value;
    case ">":
      return x > t.value;
    case "<":
      return x < t.value;
    case "<=":
      return x <= t.value;
  }
}

export type Evaluation =
  | { outcome: "alive"; note: string }
  | { outcome: "dead"; note: string }
  | { outcome: "inconclusive"; note: string };

/**
 * Decide a registered bet from observed data. `k` = successes (e.g. verified
 * pre-auths), `n` = trials (e.g. clicks). For proportion metrics the decision
 * is made on the Wilson bound; for non-proportion metrics (signal_score) it is
 * a direct point comparison.
 *
 * PASS  -> alive   (Wilson LOWER bound satisfies passIf)
 * KILL  -> dead    (Wilson UPPER bound satisfies killIf)
 * else  -> inconclusive
 *
 * This function only computes an outcome; it never writes state. The single
 * authoritative writer (applyVerification) consumes this.
 */
export function evaluate(k: number, n: number, reg: Registration): Evaluation {
  if (!PROPORTION_METRICS.has(reg.metric)) {
    // Non-proportion (e.g. Tier-0 signal_score): point comparison, no interval.
    const x = n > 0 ? k / n : k; // signal callers pass the raw score as k, n=0
    const pass = satisfies(x, reg.passIf);
    const kill = satisfies(x, reg.killIf);
    if (pass && !kill) return { outcome: "alive", note: `score ${x}` };
    if (kill && !pass) return { outcome: "dead", note: `score ${x}` };
    return { outcome: "inconclusive", note: `score ${x} between thresholds` };
  }

  if (n <= 0) {
    return { outcome: "inconclusive", note: "no samples yet" };
  }
  const ci = wilson(k, n, reg.confidence);
  const fmt = `p̂=${(ci.point * 100).toFixed(1)}% CI[${(ci.lower * 100).toFixed(
    1,
  )}%,${(ci.upper * 100).toFixed(1)}%] n=${n}`;
  const pass = satisfies(ci.lower, reg.passIf);
  const kill = satisfies(ci.upper, reg.killIf);
  // Sane thresholds (passIf.value > killIf.value) make pass && kill impossible;
  // if a founder froze contradictory thresholds, treat as inconclusive.
  if (pass && !kill) return { outcome: "alive", note: fmt };
  if (kill && !pass) return { outcome: "dead", note: fmt };
  return { outcome: "inconclusive", note: fmt };
}
