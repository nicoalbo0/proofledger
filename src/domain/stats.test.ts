import { describe, expect, it } from "vitest";
import { evaluate, invNormalCdf, wilson, zForConfidence } from "./stats.js";
import type { Registration } from "./types.js";

function reg(over: Partial<Registration>): Registration {
  return {
    id: "r_test",
    assumptionId: "a_pay",
    metric: "preauth_conversion",
    sampleTarget: 300,
    passIf: { op: ">=", value: 0.05 },
    killIf: { op: "<", value: 0.02 },
    confidence: 0.95,
    frozenAt: "2026-07-01T00:00:00.000Z",
    hash: "sha256:x",
    supersededBy: null,
    ...over,
  };
}

describe("inverse normal / z", () => {
  it("z for 95% is ~1.95996", () => {
    expect(zForConfidence(0.95)).toBeCloseTo(1.95996, 4);
  });
  it("median is 0", () => {
    expect(invNormalCdf(0.5)).toBeCloseTo(0, 6);
  });
});

describe("wilson interval", () => {
  it("50/100 ~ [0.404, 0.596]", () => {
    const ci = wilson(50, 100, 0.95);
    expect(ci.point).toBeCloseTo(0.5, 6);
    expect(ci.lower).toBeCloseTo(0.4038, 3);
    expect(ci.upper).toBeCloseTo(0.5962, 3);
  });
  it("n=0 is maximally uncertain", () => {
    expect(wilson(0, 0)).toEqual({ point: 0, lower: 0, upper: 1 });
  });
  it("bounds stay within [0,1]", () => {
    const ci = wilson(0, 5);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.upper).toBeLessThanOrEqual(1);
  });
});

describe("evaluate (gate on the bound, not the point)", () => {
  it("clear PASS: 60/300 vs passIf>=0.10 -> alive", () => {
    const e = evaluate(60, 300, reg({ passIf: { op: ">=", value: 0.1 } }));
    expect(e.outcome).toBe("alive");
  });

  it("clear KILL: 2/500 vs killIf<0.05, passIf>=0.10 -> dead", () => {
    const e = evaluate(
      2,
      500,
      reg({ passIf: { op: ">=", value: 0.1 }, killIf: { op: "<", value: 0.05 } }),
    );
    expect(e.outcome).toBe("dead");
  });

  it("the meal example: 6/300, passIf>=0.05 killIf<0.02 -> INCONCLUSIVE (wide CI)", () => {
    // Point estimate 2% looks 'dead vs 5%', but Wilson CI ~[0.9%,4.3%] neither
    // clears passIf on the lower bound nor killIf on the upper bound.
    const e = evaluate(6, 300, reg({}));
    expect(e.outcome).toBe("inconclusive");
  });

  it("no samples -> inconclusive", () => {
    expect(evaluate(0, 0, reg({})).outcome).toBe("inconclusive");
  });

  it("signal_score (Tier 0, point compare): 75 vs passIf>=70 -> alive", () => {
    const e = evaluate(
      75,
      0,
      reg({
        metric: "signal_score",
        passIf: { op: ">=", value: 70 },
        killIf: { op: "<", value: 30 },
      }),
    );
    expect(e.outcome).toBe("alive");
  });

  it("signal_score: 20 vs killIf<30 -> dead", () => {
    const e = evaluate(
      20,
      0,
      reg({
        metric: "signal_score",
        passIf: { op: ">=", value: 70 },
        killIf: { op: "<", value: 30 },
      }),
    );
    expect(e.outcome).toBe("dead");
  });
});
