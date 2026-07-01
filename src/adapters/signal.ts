import type { SignalInput } from "../domain/signal.js";

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
  async fetchSignals(query: SignalQuery): Promise<SignalInput> {
    const [demandCount, momentumCount, competitorCount, relevant, total] =
      await Promise.all([
        this.hnHits(query.keywords),
        this.githubRepos(query.keywords),
        this.githubRepos(query.competitorKeywords),
        this.relevantHits(query.keywords),
        this.totalHits(query.keywords),
      ]);
    return {
      demandCount,
      momentumCount,
      competitorCount,
      relevanceRatio: total > 0 ? relevant / total : 1,
    };
  }

  // --- thin public-API fetchers (best-effort; failures degrade to 0) ---
  private async hnHits(kw: string[]): Promise<number> {
    return this.count(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(kw.join(" "))}`,
      (j) => (j as { nbHits?: number }).nbHits ?? 0,
    );
  }
  private async githubRepos(kw: string[]): Promise<number> {
    return this.count(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(kw.join(" "))}`,
      (j) => (j as { total_count?: number }).total_count ?? 0,
    );
  }
  private async relevantHits(kw: string[]): Promise<number> {
    return this.hnHits(kw);
  }
  private async totalHits(kw: string[]): Promise<number> {
    return this.count(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(kw[0] ?? "")}`,
      (j) => (j as { nbHits?: number }).nbHits ?? 0,
    );
  }
  private async count(url: string, pick: (j: unknown) => number): Promise<number> {
    try {
      const res = await fetch(url, { headers: { "user-agent": "proofledger" } });
      if (!res.ok) return 0;
      return pick(await res.json());
    } catch {
      return 0;
    }
  }
}
