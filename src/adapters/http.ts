// Tiny fetch wrapper shared by network adapters. `fetch` is injectable so
// adapters can be unit-tested with a mock that captures requests — no network.

export type FetchImpl = typeof fetch;

export interface HttpError extends Error {
  status: number;
  body: string;
}

export async function httpJson<T = unknown>(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 400)}`) as HttpError;
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return (text ? JSON.parse(text) : {}) as T;
}
