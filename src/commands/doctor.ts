import type { FetchImpl } from "../adapters/http.js";
import type { SecretsProvider } from "../secrets/secrets.js";
import { secretKey } from "../secrets/secrets.js";
import { verifyCloudflare, verifyMeta, verifyStripe, type CredCheck } from "../adapters/verify-credentials.js";

// What each provider needs connected, and which key authenticates a ping.
const PROVIDERS = {
  stripe: { keys: ["secret", "publishable"], authKey: "secret", ping: verifyStripe },
  cloudflare: { keys: ["account", "token"], authKey: "token", ping: verifyCloudflare },
  meta: { keys: ["token", "adaccount", "page"], authKey: "token", ping: verifyMeta },
} as const;

export interface ProviderReport {
  provider: string;
  present: string[];
  missing: string[];
  ping?: CredCheck;
}

/**
 * `proofledger doctor` — report which providers are connected. With `--ping`, hits a cheap
 * authenticated endpoint per provider so a founder knows keys actually work
 * before running an experiment that spends money.
 */
export async function doctor(
  secrets: SecretsProvider,
  opts: { ping?: boolean; fetch?: FetchImpl } = {},
): Promise<ProviderReport[]> {
  const reports: ProviderReport[] = [];
  for (const [provider, spec] of Object.entries(PROVIDERS)) {
    const present: string[] = [];
    const missing: string[] = [];
    for (const k of spec.keys) {
      (((await secrets.get(secretKey(provider, k))) ? present : missing).push(k));
    }
    const report: ProviderReport = { provider, present, missing };
    if (opts.ping && present.includes(spec.authKey)) {
      const auth = (await secrets.get(secretKey(provider, spec.authKey)))!;
      report.ping = await spec.ping(opts.fetch ?? fetch, auth);
    }
    reports.push(report);
  }
  return reports;
}

/** One-line-per-provider render for the CLI. */
export function renderDoctor(reports: ProviderReport[]): string {
  return reports
    .map((r) => {
      const conn = r.missing.length === 0 ? "connected" : `missing: ${r.missing.join(", ")}`;
      const ping = r.ping ? `  ping: ${r.ping.ok ? "OK" : `FAIL (${r.ping.detail})`}` : "";
      return `${r.provider.padEnd(12)} ${conn}${ping}`;
    })
    .join("\n");
}
