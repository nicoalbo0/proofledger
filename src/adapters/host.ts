// HostAdapter — deploys a static landing bundle to the FOUNDER'S own host
// account (zero infra we operate). Cloudflare Pages is the first implementation.

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

/**
 * Cloudflare Pages via Direct Upload. Uses the founder's account id + API token.
 * Thin I/O skeleton; wired with real fetch in the M3 finish step. Chosen first
 * for a generous free tier + single-token auth (docs/technical-spec.md §11.1).
 */
export class CloudflarePagesAdapter implements HostAdapter {
  constructor(
    private accountId: string,
    private apiToken: string,
  ) {}

  async deploy(slug: string, html: string): Promise<DeployResult> {
    // Real impl: create/ensure a Pages project, then POST a Direct Upload
    // deployment containing index.html. Left as a marked skeleton so offline
    // builds/tests don't require Cloudflare credentials.
    void html;
    throw new Error(
      "CloudflarePagesAdapter.deploy not yet wired — connect Cloudflare and finish M3 host step",
    );
  }
}
