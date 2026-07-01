import type { PaymentAdapter, RawPreauth, SetupPreauthResult } from "./payment.js";

/**
 * In-memory PaymentAdapter for tests. Lets us drive the verification core with
 * controlled pre-auth sets (duplicates, wrong state, wrong tag) to prove the
 * anti-cheat filters — without touching Stripe or the network.
 */
export class FakePaymentAdapter implements PaymentAdapter {
  voided: string[] = [];
  constructor(private preauths: RawPreauth[] = []) {}

  seed(preauths: RawPreauth[]): void {
    this.preauths = preauths;
  }

  async setupPreauth(amountCents: number, experimentTag: string): Promise<SetupPreauthResult> {
    const intentId = `pi_fake_${this.preauths.length + 1}`;
    return { intentId, clientSecret: `${intentId}_secret` };
  }

  async listPreauths(experimentTag: string): Promise<RawPreauth[]> {
    // Provider would filter server-side; mimic returning everything tagged (and
    // deliberately some mistagged rows to test our own filtering too).
    return this.preauths;
  }

  async voidPreauth(intentId: string): Promise<void> {
    this.voided.push(intentId);
  }
}
