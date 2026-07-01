import { describe, expect, it } from "vitest";
import { CloudflareWorkerAdapter, buildWorkerScript, workerName } from "./host.js";
import { MetaAdAdapter, adCreativePayload, adPayload, adSetPayload, campaignPayload, sumInsights } from "./ad.js";
import { PublicSignalAdapter } from "./signal.js";
import type { FetchImpl } from "./http.js";

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): { fetch: FetchImpl; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const body = handler(u, init);
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  }) as unknown as FetchImpl;
  return { fetch, calls };
}

describe("Cloudflare host adapter", () => {
  it("workerName sanitizes and prefixes", () => {
    expect(workerName("x_AbC12_34")).toBe("pl-x-abc12-34");
  });
  it("buildWorkerScript embeds html safely + serves text/html", () => {
    const s = buildWorkerScript("<h1>hi \"q\"</h1>");
    expect(s).toContain("addEventListener");
    expect(s).toContain("text/html");
    expect(s).toContain(JSON.stringify("<h1>hi \"q\"</h1>"));
  });
  it("deploy PUTs script, enables subdomain, returns workers.dev url", async () => {
    const { fetch, calls } = mockFetch((url) =>
      url.endsWith("/workers/subdomain") ? { result: { subdomain: "acme" } } : { result: { id: "ok" } },
    );
    const host = new CloudflareWorkerAdapter("acct1", "tok", { fetch });
    const res = await host.deploy("x_abc123", "<html></html>");
    expect(res.publicUrl).toBe("https://pl-x-abc123.acme.workers.dev");
    expect(calls[0]!.init!.method).toBe("PUT");
    expect(calls.some((c) => c.url.endsWith("/subdomain") && c.init?.method === "POST")).toBe(true);
  });
});

describe("Meta ad payloads + adapter", () => {
  it("campaign is PAUSED", () => {
    expect(campaignPayload().status).toBe("PAUSED");
  });
  it("ad set budget is minor units and PAUSED", () => {
    const p = adSetPayload("c1", { keywords: ["x"], dailyBudgetUsd: 20, days: 5 });
    expect(p.daily_budget).toBe("2000");
    expect(p.status).toBe("PAUSED");
    expect(p.campaign_id).toBe("c1");
  });
  it("sumInsights adds clicks + dollar spend", () => {
    expect(sumInsights([{ clicks: "120", spend: "30.5" }, { clicks: "5", spend: "1.5" }])).toEqual({ clicks: 125, spendUsd: 32 });
  });
  it("creative embeds page id + landing link; ad is PAUSED and links the creative", () => {
    const c = adCreativePayload("PAGE1", "https://x.workers.dev", { keywords: ["x"], dailyBudgetUsd: 20, days: 5, headline: "Hi" });
    expect(c.object_story_spec).toContain("PAGE1");
    expect(c.object_story_spec).toContain("https://x.workers.dev");
    const a = adPayload("AS1", "CR1");
    expect(a.status).toBe("PAUSED");
    expect(a.adset_id).toBe("AS1");
    expect(a.creative).toContain("CR1");
  });
  it("createCampaign posts campaign→adset→creative→ad, returns campaign id", async () => {
    const { fetch, calls } = mockFetch((url) => {
      if (url.includes("/campaigns")) return { id: "111" };
      if (url.includes("/adsets")) return { id: "AS" };
      if (url.includes("/adcreatives")) return { id: "CR" };
      return { id: "AD" };
    });
    const ad = new MetaAdAdapter("token", "9999", "PAGE1", { fetch });
    const id = await ad.createCampaign("https://x.workers.dev", { keywords: ["x"], dailyBudgetUsd: 20, days: 5 });
    expect(id).toBe("111");
    expect(calls.map((c) => c.url.split("?")[0]!.split("/").pop())).toEqual(["campaigns", "adsets", "adcreatives", "ads"]);
  });
  it("insights sums Graph rows", async () => {
    const { fetch } = mockFetch(() => ({ data: [{ clicks: "300", spend: "100" }] }));
    const ad = new MetaAdAdapter("token", "9999", "PAGE1", { fetch });
    expect(await ad.insights("111")).toEqual({ clicks: 300, spendUsd: 100 });
  });
});

describe("PublicSignalAdapter", () => {
  it("computes counts + relevance from public APIs", async () => {
    const { fetch } = mockFetch((url) => {
      if (url.includes("hn.algolia")) {
        const q = new URL(url).searchParams.get("query") ?? "";
        return { nbHits: q.includes(" ") ? 100 : 200 }; // phrase 100, broad 200
      }
      if (url.includes("api.github.com")) {
        return { total_count: url.includes("comp") ? 10 : 50 };
      }
      return {};
    });
    const sig = new PublicSignalAdapter({ fetch });
    const input = await sig.fetchSignals({ keywords: ["meal", "diabetes"], competitorKeywords: ["comp"] });
    expect(input.demandCount).toBe(100);
    expect(input.momentumCount).toBe(50);
    expect(input.competitorCount).toBe(10);
    expect(input.relevanceRatio).toBeCloseTo(0.5, 6);
  });

  it("degrades to 0 on fetch failure", async () => {
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as FetchImpl;
    const sig = new PublicSignalAdapter({ fetch: failing });
    const input = await sig.fetchSignals({ keywords: ["x"], competitorKeywords: ["y"] });
    expect(input.demandCount).toBe(0);
    expect(input.relevanceRatio).toBe(1);
  });
});
