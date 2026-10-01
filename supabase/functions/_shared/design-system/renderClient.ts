// Calling render-design from another function: each call is its own request
// with its own CPU budget, authenticated with the shared server secret.
export async function renderRemote(body: Record<string, unknown>): Promise<any> {
  const secret = Deno.env.get('SOCIALYTICS_N8N_SECRET');
  if (!secret) throw new Error('The render service secret is not configured.');
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/render-design`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-socialytics-secret': secret, apikey: Deno.env.get('SUPABASE_ANON_KEY') || '' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `The render service failed [${res.status}]`);
  return data;
}
