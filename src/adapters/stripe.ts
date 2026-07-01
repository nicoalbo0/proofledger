import type { PaymentAdapter, RawPreauth, SetupPreauthResult } from "./payment.js";

// Minimal shape of a Stripe PaymentIntent we depend on. Declared locally so the
// pure mapper is testable without the SDK types installed.
export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
  latest_charge?: {
    payment_method_details?: { card?: { fingerprint?: string | null } };
  } | null;
}

export const PL_TAG_KEY = "pl_experiment";

/** Pure: Stripe PaymentIntent → provider-agnostic RawPreauth. Unit-tested offline. */
export function mapIntentToRawPreauth(pi: StripePaymentIntent): RawPreauth {
  return {
    intentId: pi.id,
    state: pi.status,
    amountCents: pi.amount,
    currency: pi.currency,
    cardFingerprint:
      pi.latest_charge?.payment_method_details?.card?.fingerprint ?? null,
    experimentTag: pi.metadata?.[PL_TAG_KEY] ?? null,
  };
}

interface StripeLike {
  paymentIntents: {
    create(args: unknown): Promise<{ id: string; client_secret: string | null }>;
    list(args: unknown): Promise<{ data: StripePaymentIntent[] }>;
    cancel(id: string): Promise<unknown>;
  };
}

/**
 * Real Stripe adapter. The SDK is imported lazily so nothing about Stripe loads
 * (or is even required as a dep) until a founder actually connects Stripe and
 * runs a Tier-2 experiment. Network calls are thin; the trust-bearing logic
 * lives in mapIntentToRawPreauth + filterCountablePreauths, both pure + tested.
 *
 * NOTE: `stripe` is an optional peer dependency, added in the M2 wiring step.
 */
export class StripePaymentAdapter implements PaymentAdapter {
  private clientPromise?: Promise<StripeLike>;
  constructor(private secretKey: string) {}

  private async client(): Promise<StripeLike> {
    if (!this.clientPromise) {
      this.clientPromise = import("stripe" as string).then(
        (m) => new (m.default as new (k: string) => StripeLike)(this.secretKey),
      );
    }
    return this.clientPromise;
  }

  async setupPreauth(amountCents: number, experimentTag: string): Promise<SetupPreauthResult> {
    const stripe = await this.client();
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      capture_method: "manual", // authorize only — do not charge
      metadata: { [PL_TAG_KEY]: experimentTag },
    });
    return { intentId: pi.id, clientSecret: pi.client_secret ?? "" };
  }

  async listPreauths(experimentTag: string): Promise<RawPreauth[]> {
    const stripe = await this.client();
    // Stripe has no server-side metadata filter on list; fetch recent and filter
    // via the pure mapper + our own tag check downstream.
    const res = await stripe.paymentIntents.list({
      limit: 100,
      expand: ["data.latest_charge"],
    });
    return res.data.map(mapIntentToRawPreauth).filter((r) => r.experimentTag === experimentTag);
  }

  async voidPreauth(intentId: string): Promise<void> {
    const stripe = await this.client();
    await stripe.paymentIntents.cancel(intentId);
  }
}
