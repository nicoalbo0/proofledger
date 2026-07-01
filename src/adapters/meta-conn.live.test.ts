import { afterAll, describe, expect, it } from "vitest";
import { httpJson } from "./http.js";
import { adSetPayload, campaignPayload, sumInsights } from "./ad.js";

// LIGHT Meta live check — validates auth, ad-account access, campaign + ad set
// creation (PAUSED, no spend) and insights, WITHOUT a Facebook Page. The Page is
// only needed for the ad creative/ad, which this test deliberately skips.
//
//   PL_LIVE_META_TOKEN=<token w/ ads_management>
//   PL_LIVE_META_ADACCOUNT=<ad account id, digits only>
//   npm run smoke:meta:conn
//
// Use this to confirm your token + ad account work before making a Page. For the
// full campaign→adset→creative→ad chain, add PL_LIVE_META_PAGE and run smoke:meta.

const TOKEN = process.env.PL_LIVE_META_TOKEN;
const ACCT = process.env.PL_LIVE_META_ADACCOUNT;
const GRAPH = "https://graph.facebook.com/v21.0";

let campaignId = "";

function form(fields: Record<string, string>): RequestInit {
  return { method: "POST", body: new URLSearchParams({ ...fields, access_token: TOKEN! }) };
}

describe.skipIf(!TOKEN || !ACCT)("Meta connectivity (no Page, no spend)", () => {
  afterAll(async () => {
    if (!TOKEN || !campaignId) return;
    await fetch(`${GRAPH}/${campaignId}?access_token=${encodeURIComponent(TOKEN)}`, { method: "DELETE" });
  });

  it("authenticates and reads the token identity", async () => {
    if (!TOKEN) return;
    const me = await httpJson<{ id: string }>(fetch, `${GRAPH}/me?access_token=${encodeURIComponent(TOKEN)}`);
    expect(typeof me.id).toBe("string");
  });

  it("creates a PAUSED campaign + ad set and reads insights", async () => {
    if (!TOKEN || !ACCT) return;
    const acct = `act_${ACCT}`;
    const camp = await httpJson<{ id: string }>(fetch, `${GRAPH}/${acct}/campaigns`, form(campaignPayload()));
    campaignId = camp.id;
    expect(campaignId.length).toBeGreaterThan(0);

    const adset = await httpJson<{ id: string }>(
      fetch,
      `${GRAPH}/${acct}/adsets`,
      form(adSetPayload(camp.id, { keywords: ["smoke"], dailyBudgetUsd: 1, days: 1 })),
    );
    expect(adset.id.length).toBeGreaterThan(0);

    const res = await httpJson<{ data?: { clicks?: string; spend?: string }[] }>(
      fetch,
      `${GRAPH}/${campaignId}/insights?fields=clicks,spend&access_token=${encodeURIComponent(TOKEN)}`,
    );
    expect(sumInsights(res.data ?? [])).toHaveProperty("clicks");
  }, 60_000);
});
