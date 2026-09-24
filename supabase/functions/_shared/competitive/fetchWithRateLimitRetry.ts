/** Retry read-only provider requests after a short, explicit rate-limit delay. */
export async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  dependencies = { fetch, sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)) },
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await dependencies.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 429 || attempt >= 2) return response;
    const header = response.headers.get('retry-after');
    const message = await response.clone().text();
    const seconds = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000)
      : Number(message.match(/retry after\s+(\d+)\s*s/i)?.[1] ?? 2);
    // Long quota windows need a later attempt, not an indefinitely running function.
    if (!Number.isFinite(seconds) || seconds > 5) return response;
    await dependencies.sleep(Math.max(1, seconds) * 1000);
  }
}
