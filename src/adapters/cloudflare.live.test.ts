import { afterAll, describe, expect, it } from "vitest";
import { CloudflareWorkerAdapter, workerName } from "./host.js";

// LIVE smoke test against Cloudflare (free tier). Skipped unless both are set:
//   PL_LIVE_CF_ACCOUNT=<account id>  PL_LIVE_CF_TOKEN=<api token>  npm run smoke:cf
//
// The API token needs "Workers Scripts: Edit". Deploys a real Worker, fetches
// its workers.dev URL, asserts the landing HTML is served, then deletes it.

const ACCOUNT = process.env.PL_LIVE_CF_ACCOUNT;
const TOKEN = process.env.PL_LIVE_CF_TOKEN;
const slug = `x_smoke_${Date.now()}`;

async function getText(url: string, tries = 8): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    if (res.ok) return res.text();
    await new Promise((r) => setTimeout(r, 1500)); // workers.dev propagation
  }
  throw new Error(`URL never served 200: ${url}`);
}

describe.skipIf(!ACCOUNT || !TOKEN)("Cloudflare Worker live smoke", () => {
  afterAll(async () => {
    if (!ACCOUNT || !TOKEN) return;
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${workerName(slug)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("deploys a landing page and serves it publicly", async () => {
    if (!ACCOUNT || !TOKEN) return;
    const host = new CloudflareWorkerAdapter(ACCOUNT, TOKEN);
    const marker = `pl-smoke-${Date.now()}`;
    const html = `<!doctype html><title>smoke</title><h1>${marker}</h1>`;

    const res = await host.deploy(slug, html);
    expect(res.publicUrl).toContain(".workers.dev");

    const served = await getText(res.publicUrl);
    expect(served).toContain(marker);
  }, 60_000);
});
