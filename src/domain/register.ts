import { newId } from "../util/id.js";
import type { Clock } from "../util/clock.js";
import { hashRegistration } from "./integrity.js";
import type { Metric, Registration, Threshold } from "./types.js";

export interface FreezeInput {
  assumptionId: string;
  metric: Metric;
  sampleTarget: number;
  passIf: Threshold;
  killIf: Threshold;
  confidence?: number;
}

export class InvalidThresholdError extends Error {}

/**
 * Freeze a bet into an immutable Registration. After this returns, the thresholds
 * are hash-locked; changing them means creating a NEW registration (supersede),
 * never editing this one. See docs/data-model.md §2.3.
 */
export function freezeRegistration(input: FreezeInput, clock: Clock): Registration {
  const confidence = input.confidence ?? 0.95;
  if (input.sampleTarget <= 0) {
    throw new InvalidThresholdError("sampleTarget must be > 0");
  }
  if (confidence <= 0 || confidence >= 1) {
    throw new InvalidThresholdError("confidence must be in (0,1)");
  }
  // Guard the goalposts: PASS must sit strictly above KILL, else the bet is
  // unfalsifiable (a result could satisfy both, or neither by construction).
  if (input.passIf.value <= input.killIf.value) {
    throw new InvalidThresholdError(
      `passIf (${input.passIf.value}) must exceed killIf (${input.killIf.value})`,
    );
  }

  const draft: Registration = {
    id: newId("r"),
    assumptionId: input.assumptionId,
    metric: input.metric,
    sampleTarget: input.sampleTarget,
    passIf: input.passIf,
    killIf: input.killIf,
    confidence,
    frozenAt: clock.iso(),
    hash: "", // filled below
    supersededBy: null,
  };
  draft.hash = hashRegistration(draft);
  return draft;
}
