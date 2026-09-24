/** Bounded backoff for RivalIQ reads. Never replay a provider mutation. */
export async function rivalIqFetch(
  url: string, init: RequestInit = {},
  runtime: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; random?: () => number } = {},
): Promise<Response> {
  const send = runtime.fetch || fetch;
  const sleep = runtime.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = runtime.now || Date.now;
  const random = runtime.random || Math.random;
  // Keep writes on their existing journal/reconciliation path.
  if ((init.method || 'GET').toUpperCase() !== 'GET') return send(url, init);
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    if (init.signal?.aborted) throw init.signal.reason || new DOMException('Aborted', 'AbortError');
    const response = await send(url, init);
    if (attempt >= 3 || ![429, 502, 503, 504].includes(response.status)) return response;
    if (response.status === 429) {
      const detail = await response.clone().text().catch(() => '');
      // An hourly quota cannot recover from a short retry. Preserve the
      // provider response so callers can show the actual failure.
      if (/HourRateLimitExceeded/i.test(detail)) return response;
    }
    const header = response.headers.get('Retry-After');
    let delay = Math.round(1000 * 2 ** attempt + random() * 500);
    if (header != null) {
      const seconds = Number(header);
      const requested = header.trim() !== '' && Number.isFinite(seconds)
        ? seconds * 1000 : Date.parse(header) - now();
      if (Number.isFinite(requested)) delay = Math.max(delay, requested);
    }
    // Never shorten a provider's Retry-After to fit our budget.
    if (waited + delay > 12000) return response;
    await response.body?.cancel();
    await sleep(delay);
    waited += delay;
  }
}
