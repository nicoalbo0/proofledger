import { type FetchImpl } from "./http.js";

// Cheap, read-only credential checks — a founder runs `proofledger doctor --ping` to know
// keys work before spending a cent. Each hits the smallest authenticated GET the
// provider offers. Injectable fetch for offline tests.

export interface CredCheck {
  ok: boolean;
  detail: string;
}

async function probe(fetchImpl: FetchImpl, url: string, init: RequestInit, ok: (j: unknown) => boolean): Promise<CredCheck> {
  try {
    const res = await fetchImpl(url, init);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: ok(await res.json()), detail: res.ok ? "reachable" : "unexpected" };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

export function verifyStripe(fetchImpl: FetchImpl, secretKey: string): Promise<CredCheck> {
  return probe(fetchImpl, "https://api.stripe.com/v1/balance", { headers: { authorization: `Bearer ${secretKey}` } }, () => true);
}

export function verifyCloudflare(fetchImpl: FetchImpl, token: string): Promise<CredCheck> {
  return probe(
    fetchImpl,
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
    { headers: { authorization: `Bearer ${token}` } },
    (j) => (j as { result?: { status?: string } }).result?.status === "active",
  );
}

export function verifyMeta(fetchImpl: FetchImpl, token: string): Promise<CredCheck> {
  return probe(
    fetchImpl,
    `https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(token)}`,
    {},
    (j) => typeof (j as { id?: string }).id === "string",
  );
}
