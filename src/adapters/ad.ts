// AdAdapter — launches a demand-test ad set on the FOUNDER'S own ad account and
// reports back real clicks + spend. Meta first. Campaigns are created PAUSED;
// activation is a separate, explicitly-confirmed step (never auto-spends).

export interface AdTargeting {
  keywords: string[];
  dailyBudgetUsd: number;
  days: number;
}

export interface AdInsights {
  clicks: number;
  spendUsd: number;
}

export interface AdAdapter {
  /** Create a PAUSED campaign pointing at the landing URL. Returns its id. */
  createCampaign(landingUrl: string, targeting: AdTargeting): Promise<string>;
  activate(campaignId: string): Promise<void>;
  pause(campaignId: string): Promise<void>;
  insights(campaignId: string): Promise<AdInsights>;
}

/** Projected total spend of a targeting plan; used for the budget-cap guard. */
export function projectedSpendUsd(t: AdTargeting): number {
  return t.dailyBudgetUsd * t.days;
}

/** In-memory adapter for tests. */
export class FakeAdAdapter implements AdAdapter {
  active = new Set<string>();
  private seeded: AdInsights = { clicks: 0, spendUsd: 0 };
  private n = 0;
  seedInsights(i: AdInsights): void {
    this.seeded = i;
  }
  async createCampaign(): Promise<string> {
    return `camp_${++this.n}`;
  }
  async activate(id: string): Promise<void> {
    this.active.add(id);
  }
  async pause(id: string): Promise<void> {
    this.active.delete(id);
  }
  async insights(): Promise<AdInsights> {
    return this.seeded;
  }
}

/**
 * Meta Marketing API skeleton. Real fetch wiring added in the M4 finish step;
 * kept a marked skeleton so offline builds/tests need no Meta credentials.
 */
export class MetaAdAdapter implements AdAdapter {
  constructor(
    private accessToken: string,
    private adAccountId: string,
  ) {}
  async createCampaign(): Promise<string> {
    throw new Error("MetaAdAdapter not yet wired — connect Meta and finish M4 ad step");
  }
  async activate(): Promise<void> {
    throw new Error("MetaAdAdapter not yet wired");
  }
  async pause(): Promise<void> {
    throw new Error("MetaAdAdapter not yet wired");
  }
  async insights(): Promise<AdInsights> {
    throw new Error("MetaAdAdapter not yet wired");
  }
}
