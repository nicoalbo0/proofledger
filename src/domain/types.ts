// Canonical entity contract. JSON on disk under .proofledger/ matches these 1:1.
// See docs/data-model.md. Keep this file and that doc in sync.

// ---------- Config ----------
export interface Config {
  version: 1;
  productGlobs: string[];
  budget: {
    perExperimentUsdCap: number;
    requireActivationConfirm: true;
  };
  decayHalfLifeDays: number;
  providers: {
    payment?: "stripe";
    ads?: "meta" | "google";
    host?: "cloudflare_pages" | "vercel";
    survey?: "tally" | "typeform";
    transcript?: "whisper_local" | "provider";
    signal: "public";
  };
  verdictLlm: { provider: string; model: string };
}

// ---------- Hypothesis + Assumption ----------
export type AssumptionStatus =
  | "untested"
  | "alive"
  | "dead"
  | "decayed"
  | "inconclusive";

export type EvidenceTier = 0 | 1 | 2 | 3;

export interface Assumption {
  id: string;
  text: string;
  critical: boolean;
  gate: boolean; // exactly one per hypothesis
  status: AssumptionStatus; // written ONLY by applyVerification()
  minTier: EvidenceTier; // lowest tier that can mark it `alive` (gate node => 2)
  activeRegistrationId?: string;
  note?: string;
}

export interface Hypothesis {
  id: string;
  claim: string;
  createdAt: string;
  status: "active" | "archived";
  assumptions: Assumption[];
}

// ---------- Registration (immutable once frozen) ----------
export type CmpOp = ">=" | ">" | "<" | "<=";
export interface Threshold {
  op: CmpOp;
  value: number;
}

export type Metric =
  | "preauth_conversion"
  | "email_conversion"
  | "signal_score"
  | "interview_yes_rate";

export interface Registration {
  id: string;
  assumptionId: string;
  metric: Metric;
  sampleTarget: number;
  passIf: Threshold; // evaluated against Wilson LOWER bound for proportions
  killIf: Threshold; // evaluated against Wilson UPPER bound for proportions
  confidence: number; // default 0.95
  frozenAt: string;
  hash: string; // sha256 over the frozen fields; verified on every read
  supersededBy: string | null;
}

/** The subset of a Registration that the integrity hash covers. */
export interface RegistrationCore {
  assumptionId: string;
  metric: Metric;
  sampleTarget: number;
  passIf: Threshold;
  killIf: Threshold;
  confidence: number;
  frozenAt: string;
}

// ---------- Experiment ----------
export type ExperimentStatus =
  | "draft"
  | "deploying"
  | "running"
  | "paused"
  | "verifying"
  | "closed";

export interface Experiment {
  id: string;
  assumptionId: string;
  registrationId: string;
  tier: EvidenceTier;
  status: ExperimentStatus;
  providerRefs: {
    landingUrl?: string;
    hostDeployId?: string;
    adCampaignId?: string;
    stripeMetadataTag?: string;
    surveyFormId?: string;
  };
  counters: {
    clicks?: number;
    emails?: number;
    preauths?: number;
    spendUsd?: number;
    polledAt?: string;
  };
  startedAt?: string;
  closedAt?: string;
}

// ---------- Evidence ----------
export type EvidenceStatus = "verified" | "provided" | "assumed" | "unknown";

export type EvidenceType =
  | "stripe_preauth"
  | "ad_conversion"
  | "email_capture"
  | "interview"
  | "signal_desk"
  | "captured_sale";

export interface Evidence {
  id: string;
  experimentId: string;
  assumptionId: string;
  tier: EvidenceTier;
  type: EvidenceType;
  status: EvidenceStatus;
  value: number;
  source: {
    system:
      | "stripe"
      | "meta"
      | "google"
      | "host"
      | "survey"
      | "transcript"
      | "public";
    objectId?: string;
    state?: string;
    fingerprint?: string;
  };
  fetchedAt: string;
  expiresAt: string;
}

// ---------- Ledger index ----------
export type Verdict = "SHIP" | "SHARPEN" | "PIVOT" | "KILL" | "PENDING";

export interface Ledger {
  version: 1;
  activeHypothesisId: string | null;
  gate: {
    state: "open" | "locked";
    reason: string;
    gatingAssumptionId: string | null;
    lastEvaluatedAt: string;
    overrides: { at: string; reason: string; by: string }[];
  };
  verdicts: Record<
    string,
    { verdict: Verdict; computedAt: string; explanation: string }
  >;
}
