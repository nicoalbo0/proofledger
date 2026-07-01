import type { SignalInput } from "../domain/signal.js";
import type { FetchImpl } from "./http.js";

export interface SignalQuery {
  keywords: string[];
  competitorKeywords: string[];
}

export interface SignalAdapter {
  /** Gather public desk signals for a query. Zero-auth, zero-cost sources. */
  fetchSignals(query: SignalQuery): Promise<SignalInput>;
}

/** In-memory adapter for tests. */
export class FakeSignalAdapter implements SignalAdapter {
  constructor(private input: SignalInput) {}
  async fetchSignals(): Promise<SignalInput> {
    return this.input;
  }
}

/**
 * Real Tier-0 adapter over free, unauthenticated public sources (mirrors
 * venture-analyst / impact-compass): HN Algolia, Reddit JSON, GitHub search,
 * Google Trends. Network only; the scoring math lives in domain/signal.ts and is
 * tested separately. Wired with real fetches in the M3 finish step.
 */
export class PublicSignalAdapter implements SignalAdapter {
  private fetch: FetchImpl;
  constructor(deps: { fetch?: FetchImpl } = {}) {
    this.fetch = deps.fetch ?? fetch;
  }

  async fetchSignals(query: SignalQuery): Promise<SignalInput> {
    const kw = query.keywords;
    const first = kw[0] ?? "";
    const [demandCount, momentumCount, competitorCount, phraseHits, broadHits] =
      await Promise.all([
        this.hnHits(kw), // demand = complaints/mentions of the full phrase
        this.githubRepos(kw), // momentum = building activity
        this.githubRepos(query.competitorKeywords), // competitors
        this.hnHits(kw), // relevant = full-phrase hits
        this.hnHits(first ? [first] : []), // broad = single-keyword hits
      ]);
    // Relevance = how much of the broad interest actually matches the full idea.
    const relevanceRatio = broadHits > 0 ? Math.min(1, phraseHits / broadHits) : 1;
    return { demandCount, momentumCount, competitorCount, relevanceRatio };
  }

  // --- thin public-API fetchers (best-effort; failures degrade to 0) ---
  private hnHits(kw: string[]): Promise<number> {
    if (kw.length === 0) return Promise.resolve(0);
    return this.count(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(kw.join(" "))}`,
      (j) => (j as { nbHits?: number }).nbHits ?? 0,
    );
  }
  private githubRepos(kw: string[]): Promise<number> {
    if (kw.length === 0) return Promise.resolve(0);
    return this.count(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(kw.join(" "))}`,
      (j) => (j as { total_count?: number }).total_count ?? 0,
    );
  }
  private async count(url: string, pick: (j: unknown) => number): Promise<number> {
    try {
      const res = await this.fetch(url, { headers: { "user-agent": "proofledger" } });
      if (!res.ok) return 0;
      return pick(await res.json());
    } catch {
      return 0;
    }
  }
}
