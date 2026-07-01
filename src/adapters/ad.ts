import { httpJson, type FetchImpl } from "./http.js";

// AdAdapter — launches a demand-test ad set on the FOUNDER'S own ad account and
// reports back real clicks + spend. Meta first. Campaigns are created PAUSED;
// activation is a separate, explicitly-confirmed step (never auto-spends).

export interface AdTargeting {
  keywords: string[];
  dailyBudgetUsd: number;
  days: number;
  /** ISO country codes for broad reach; keyword→interest targeting is a later refinement. */
  countries?: string[];
  /** Ad copy shown to users; defaults applied if omitted. */
  headline?: string;
  body?: string;
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

// ---- pure Graph API payload builders (unit-tested; no network) ----

export function campaignPayload(): Record<string, string> {
  return {
    name: "ProofLedger demand test",
    objective: "OUTCOME_TRAFFIC",
    status: "PAUSED",
    special_ad_categories: "[]",
    // Budget lives on the ad set, not the campaign. Graph v21 then requires this
    // field to be set explicitly. false = each ad set keeps its own budget.
    is_adset_budget_sharing_enabled: "false",
  };
}

export function adSetPayload(campaignId: string, t: AdTargeting): Record<string, string> {
  const targeting = {
    geo_locations: { countries: t.countries ?? ["US"] },
    age_min: 18,
    age_max: 65,
  };
  return {
    name: "ProofLedger ad set",
    campaign_id: campaignId,
    daily_budget: String(Math.round(t.dailyBudgetUsd * 100)), // Meta uses minor units
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: JSON.stringify(targeting),
    status: "PAUSED",
  };
}

/** A link-ad creative pointing at the landing page (needs a Facebook Page id). */
export function adCreativePayload(pageId: string, landingUrl: string, t: AdTargeting): Record<string, string> {
  const objectStorySpec = {
    page_id: pageId,
    link_data: {
      link: landingUrl,
      message: t.body ?? "Reserve your spot.",
      name: t.headline ?? "Coming soon",
      call_to_action: { type: "SIGN_UP", value: { link: landingUrl } },
    },
  };
  return { name: "ProofLedger creative", object_story_spec: JSON.stringify(objectStorySpec) };
}

/** The ad object that ties the ad set to the creative. Created PAUSED. */
export function adPayload(adSetId: string, creativeId: string): Record<string, string> {
  return {
    name: "ProofLedger ad",
    adset_id: adSetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: "PAUSED",
  };
}

/** Sum clicks + spend across Graph insights rows (spend is returned in dollars). */
export function sumInsights(rows: { clicks?: string; spend?: string }[]): AdInsights {
  let clicks = 0;
  let spendUsd = 0;
  for (const r of rows) {
    clicks += Number(r.clicks ?? 0);
    spendUsd += Number(r.spend ?? 0);
  }
  return { clicks, spendUsd };
}

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Meta Marketing API. Full demand-test flow: PAUSED campaign → ad set (budget +
 * broad geo targeting) → link creative (Facebook Page) → ad. Everything is
 * created PAUSED so nothing delivers until `activate`. The trust-bearing math
 * (projectedSpend, sumInsights) is pure + tested; network calls are thin
 * form-POSTs. keyword→interest targeting is a later refinement.
 */
export class MetaAdAdapter implements AdAdapter {
  private fetch: FetchImpl;
  constructor(
    private accessToken: string,
    private adAccountId: string,
    private pageId: string,
    deps: { fetch?: FetchImpl } = {},
  ) {
    this.fetch = deps.fetch ?? fetch;
  }

  private form(fields: Record<string, string>): RequestInit {
    const body = new URLSearchParams({ ...fields, access_token: this.accessToken });
    return { method: "POST", body };
  }

  async createCampaign(landingUrl: string, targeting: AdTargeting): Promise<string> {
    const acct = `act_${this.adAccountId}`;
    const camp = await httpJson<{ id: string }>(this.fetch, `${GRAPH}/${acct}/campaigns`, this.form(campaignPayload()));
    const adset = await httpJson<{ id: string }>(this.fetch, `${GRAPH}/${acct}/adsets`, this.form(adSetPayload(camp.id, targeting)));
    const creative = await httpJson<{ id: string }>(this.fetch, `${GRAPH}/${acct}/adcreatives`, this.form(adCreativePayload(this.pageId, landingUrl, targeting)));
    await httpJson<{ id: string }>(this.fetch, `${GRAPH}/${acct}/ads`, this.form(adPayload(adset.id, creative.id)));
    return camp.id;
  }

  async activate(campaignId: string): Promise<void> {
    await httpJson(this.fetch, `${GRAPH}/${campaignId}`, this.form({ status: "ACTIVE" }));
  }

  async pause(campaignId: string): Promise<void> {
    await httpJson(this.fetch, `${GRAPH}/${campaignId}`, this.form({ status: "PAUSED" }));
  }

  async insights(campaignId: string): Promise<AdInsights> {
    const url = `${GRAPH}/${campaignId}/insights?fields=clicks,spend&access_token=${encodeURIComponent(this.accessToken)}`;
    const res = await httpJson<{ data: { clicks?: string; spend?: string }[] }>(this.fetch, url);
    return sumInsights(res.data ?? []);
  }
}
