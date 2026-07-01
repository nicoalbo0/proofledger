// PaymentAdapter — the contract every payment provider (Stripe first) implements.
// The verification core depends only on this interface, never on a concrete SDK,
// so the anti-cheat logic is provider-agnostic and testable with a fake.

/** A pre-authorization as re-fetched from the provider (source of truth). */
export interface RawPreauth {
  intentId: string;
  /** Provider state; only "requires_capture" counts as a live, un-captured hold. */
  state: string;
  amountCents: number;
  currency: string;
  /** Card fingerprint — stable per physical card, used to dedupe one card × N. */
  cardFingerprint: string | null;
  /** Our tag echoed back, links the hold to the experiment we created. */
  experimentTag: string | null;
}

export interface SetupPreauthResult {
  intentId: string;
  clientSecret: string;
}

export interface PaymentAdapter {
  /** Create a manual-capture PaymentIntent tagged to an experiment. */
  setupPreauth(amountCents: number, experimentTag: string): Promise<SetupPreauthResult>;
  /** Re-fetch all pre-auths tagged with the experiment. Independent of any count we hold. */
  listPreauths(experimentTag: string): Promise<RawPreauth[]>;
  /** Release a hold after counting (signal, not a sale) unless Tier-3 opts into capture. */
  voidPreauth(intentId: string): Promise<void>;
}
