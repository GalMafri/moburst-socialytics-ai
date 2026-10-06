declare const Deno: { env: { get(name: string): string | undefined } };

/** One connection coordinator for imports, setup, feeds, manual and scheduled reports. */
export async function coordinatedRivalIqFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const rpc = async (name: string, body: unknown) => {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Could not coordinate the RivalIQ connection');
    return response.status === 204 ? null : response.json();
  };
  const token = crypto.randomUUID();
  const deadline = Date.now() + 25000;
  for (;;) {
    if (init.signal?.aborted) throw init.signal.reason;
    const lease = await rpc('claim_rivaliq_request', { request_token: token });
    if (lease.acquired) break;
    if (lease.reason === 'hourly_budget' || Date.now() >= deadline) {
      return new Response(JSON.stringify({ error: lease.reason === 'hourly_budget' ? 'HourRateLimitExceeded' : 'ConnectionBusy' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(lease.retry_after || 2) } });
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  // Keep the lease until the whole body arrives. On a timeout/network exception
  // let it expire: cancelling our socket does not prove the provider stopped.
  const signals = [AbortSignal.timeout(80000), ...(init.signal ? [init.signal] : [])];
  const response = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
  const body = await response.text();
  const cooldown = response.status === 429 && /HourRateLimitExceeded/i.test(body)
    ? Math.max(1, Number(response.headers.get('Retry-After')) || 3600) : 0;
  await rpc('release_rivaliq_request', { request_token: token, cooldown_seconds: cooldown });
  // A 204 (a DELETE's answer) may not carry a body, even an empty one.
  return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
}
