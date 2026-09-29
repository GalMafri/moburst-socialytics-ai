import { secretEquals } from '../_shared/auth/secretEquals.ts';
import { rivalIqFetch } from '../_shared/competitive/rivaliqFetch.ts';

/** Internal workflow adapter. Provider credentials stay in the edge environment. */
Deno.serve(async req => {
  const secret = Deno.env.get('SOCIALYTICS_N8N_SECRET');
  if (!secret || !await secretEquals(req.headers.get('x-socialytics-secret'), secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (req.method !== 'GET') return Response.json({ error: 'GET required' }, { status: 405 });
  const incoming = new URL(req.url);
  const path = incoming.searchParams.get('path') || '';
  if (!/^\/v3\/landscapes(?:\/\d+\/(?:status|companies|socialposts|metrics\/(?:summary|timeseries)))?$/.test(path)) {
    return Response.json({ error: 'Unsupported RivalIQ read' }, { status: 400 });
  }
  const key = Deno.env.get('RIVALIQ_API_KEY');
  if (!key) return Response.json({ error: 'RivalIQ is not configured' }, { status: 503 });
  const target = new URL(`https://api.rivaliq.com${path}`);
  for (const name of ['mainPeriodStart','mainPeriodEnd','limit','channel']) {
    const value = incoming.searchParams.get(name);
    if (value != null) target.searchParams.set(name, value);
  }
  target.searchParams.set('apiKey', key);
  try {
    const response = await rivalIqFetch(target.href, { headers: { Accept: 'application/json' } });
    const text = (await response.text()).replaceAll(key, '[redacted]').replaceAll(encodeURIComponent(key), '[redacted]');
    return new Response(text, { status: response.status, headers: {
      'Content-Type': 'application/json', ...(response.headers.get('Retry-After') ? { 'Retry-After': response.headers.get('Retry-After')! } : {}),
    } });
  } catch {
    return Response.json({ error: 'RivalIQ request did not complete; connection lease retained until expiry' }, { status: 502 });
  }
});
