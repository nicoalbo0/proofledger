import { afterAll, describe, expect, it } from "vitest";
import { MetaAdAdapter } from "./ad.js";

// LIVE smoke test against Meta Marketing API. Skipped unless all three are set:
//   PL_LIVE_META_TOKEN=<user token w/ ads_management>
//   PL_LIVE_META_ADACCOUNT=<ad account id, digits only>
//   PL_LIVE_META_PAGE=<facebook page id>
//   npm run smoke:meta
//
// Creates the full campaign→adset→creative→ad chain, ALL PAUSED (no delivery,
// no spend), reads insights, then deletes the campaign. Never activates.

const TOKEN = process.env.PL_LIVE_META_TOKEN;
const ACCT = process.env.PL_LIVE_META_ADACCOUNT;
const PAGE = process.env.PL_LIVE_META_PAGE;
const GRAPH = "https://graph.facebook.com/v21.0";

let campaignId = "";

describe.skipIf(!TOKEN || !ACCT || !PAGE)("Meta live smoke (paused, no spend)", () => {
  afterAll(async () => {
    if (!TOKEN || !campaignId) return;
    // Deleting the campaign cascades to its ad sets + ads.
    await fetch(`${GRAPH}/${campaignId}?access_token=${encodeURIComponent(TOKEN)}`, { method: "DELETE" });
  });

  it("creates a PAUSED campaign chain and reads insights", async () => {
    if (!TOKEN || !ACCT || !PAGE) return;
    const ad = new MetaAdAdapter(TOKEN, ACCT, PAGE);

    campaignId = await ad.createCampaign("https://example.com/pl-smoke", {
      keywords: ["smoke"],
      dailyBudgetUsd: 1,
      days: 1,
      headline: "ProofLedger smoke",
      body: "ignore — API validation only",
    });
    expect(typeof campaignId).toBe("string");
    expect(campaignId.length).toBeGreaterThan(0);

    // Insights on a brand-new paused campaign return no rows -> zeros, no error.
    const ins = await ad.insights(campaignId);
    expect(ins).toHaveProperty("clicks");
    expect(ins).toHaveProperty("spendUsd");
  }, 60_000);
});
