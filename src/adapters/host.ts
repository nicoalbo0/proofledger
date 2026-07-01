import { httpJson, type FetchImpl } from "./http.js";

// HostAdapter — deploys a static landing bundle to the FOUNDER'S own host
// account (zero infra we operate).

export interface DeployResult {
  publicUrl: string;
  deployId: string;
}

export interface HostAdapter {
  /** Deploy a single static HTML page under a project slug; return its public URL. */
  deploy(slug: string, html: string): Promise<DeployResult>;
}

/** In-memory adapter for tests. */
export class FakeHostAdapter implements HostAdapter {
  deployed: { slug: string; html: string }[] = [];
  async deploy(slug: string, html: string): Promise<DeployResult> {
    this.deployed.push({ slug, html });
    return { publicUrl: `https://${slug}.fake.pages.dev`, deployId: `dep_${this.deployed.length}` };
  }
}

const CF_BASE = "https://api.cloudflare.com/client/v4";

/** Cloudflare Worker names: lowercase alnum + hyphen, must start with a letter. */
export function workerName(slug: string): string {
  const cleaned = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `pl-${cleaned}`.slice(0, 54);
}

/** Service-worker script that serves the landing HTML. Pure + testable. */
export function buildWorkerScript(html: string): string {
  return `addEventListener("fetch", (event) => {
  event.respondWith(
    new Response(${JSON.stringify(html)}, {
      headers: { "content-type": "text/html;charset=utf-8" },
    }),
  );
});`;
}

interface CfResult<T> {
  result: T;
}

/**
 * Deploys the landing page as a Cloudflare Worker on the founder's account and
 * exposes it on <name>.<account-subdomain>.workers.dev. One PUT + subdomain
 * enable — far more reliable via pure API than Pages Direct Upload (which needs
 * a file-hash manifest + upload token). Same HostAdapter contract either way.
 */
export class CloudflareWorkerAdapter implements HostAdapter {
  private fetch: FetchImpl;
  constructor(
    private accountId: string,
    private apiToken: string,
    deps: { fetch?: FetchImpl } = {},
  ) {
    this.fetch = deps.fetch ?? fetch;
  }

  private headers(contentType?: string): Record<string, string> {
    const h: Record<string, string> = { authorization: `Bearer ${this.apiToken}` };
    if (contentType) h["content-type"] = contentType;
    return h;
  }

  async deploy(slug: string, html: string): Promise<DeployResult> {
    const name = workerName(slug);

    // 1. Upload the Worker script (service-worker format).
    await httpJson(this.fetch, `${CF_BASE}/accounts/${this.accountId}/workers/scripts/${name}`, {
      method: "PUT",
      headers: this.headers("application/javascript"),
      body: buildWorkerScript(html),
    });

    // 2. Expose it on workers.dev.
    await httpJson(this.fetch, `${CF_BASE}/accounts/${this.accountId}/workers/scripts/${name}/subdomain`, {
      method: "POST",
      headers: this.headers("application/json"),
      body: JSON.stringify({ enabled: true }),
    });

    // 3. Resolve the account's workers.dev subdomain to build the URL.
    const sub = await httpJson<CfResult<{ subdomain: string }>>(
      this.fetch,
      `${CF_BASE}/accounts/${this.accountId}/workers/subdomain`,
      { headers: this.headers() },
    );

    return {
      publicUrl: `https://${name}.${sub.result.subdomain}.workers.dev`,
      deployId: name,
    };
  }
}
