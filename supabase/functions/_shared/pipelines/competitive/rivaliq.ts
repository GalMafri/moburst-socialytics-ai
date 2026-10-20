// RivalIQ reads for the in-app competitive pipeline: the same reads the n8n
// workflow makes through the rivaliq-request function, with the same paths
// and parameters, through the same connection coordinator
// (rivaliqFetch.ts and rivaliqConnection.ts: one call at a time across every
// caller, the hourly budget kept). A pipeline step is its own server, so it
// calls RivalIQ directly with RIVALIQ_API_KEY rather than through the proxy.
//
// The coordinator answers 429 when the connection is busy or the hourly
// budget is spent; that is RivalIqBusy here, and the step waits the time
// RivalIQ (or the coordinator) asked for and looks again, which is not a
// failed try. Any other failure is thrown for the runner's quiet retries.

import { rivalIqFetch } from "../../competitive/rivaliqFetch.ts";

export const RIVALIQ_API = "https://api.rivaliq.com";

/** The reads the workflow makes, as rivaliq-request allows them. */
const READ_PATH = /^\/v3\/landscapes(?:\/\d+\/(?:status|companies|socialposts|metrics\/(?:summary|timeseries)))?$/;

export class RivalIqBusy extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RivalIqBusy";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type RivalIqRead = (path: string, query: Record<string, string>, signal?: AbortSignal) => Promise<unknown>;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function rivalIqReader(apiKey: string, fetcher: Fetcher = rivalIqFetch): RivalIqRead {
  const redact = (text: string) => text.split(apiKey).join("[redacted]").split(encodeURIComponent(apiKey)).join("[redacted]");
  return async (path, query, signal) => {
    if (!READ_PATH.test(path)) throw new Error(`Unsupported RivalIQ read: ${path}`);
    const url = new URL(`${RIVALIQ_API}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set("apiKey", apiKey);
    const response = await fetcher(url.href, { headers: { Accept: "application/json" }, ...(signal ? { signal } : {}) });
    const text = redact(await response.text());
    if (response.status === 429) {
      const after = Number(response.headers.get("Retry-After"));
      throw new RivalIqBusy(`RivalIQ ${path} is busy: ${text.slice(0, 200)}`, Number.isFinite(after) && after > 0 ? after : 60);
    }
    if (!response.ok) throw new Error(`RivalIQ ${path} answered ${response.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`RivalIQ ${path} answered with something that is not JSON.`);
    }
  };
}
