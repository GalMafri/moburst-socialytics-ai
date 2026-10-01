// Server-to-server calls to the reader, one round per request, so each round
// keeps its own CPU budget. Same shared secret as the other internal calls.
export async function readRemote(body: Record<string, unknown>): Promise<any> {
  const secret = Deno.env.get('SOCIALYTICS_N8N_SECRET');
  if (!secret) throw new Error('The design service secret is not configured.');
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/read-social-template`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-socialytics-secret': secret, apikey: Deno.env.get('SUPABASE_ANON_KEY') || '' }, body: JSON.stringify(body), signal: AbortSignal.timeout(140000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `The post reader failed [${res.status}]`);
  return data;
}
