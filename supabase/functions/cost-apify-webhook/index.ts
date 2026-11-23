import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { parseApifyWebhook } from "../_shared/cost/apify.ts";
import { paid } from "../_shared/paid/index.ts";
import { TOOL } from "../_shared/paid/config.ts";

/**
 * Apify calls this when a run Socialytics started ends (the ad-hoc webhook the
 * paying desk attaches to every run it starts; see _shared/cost/apify.ts).
 * The URL carries ?secret=COST_WEBHOOK_SECRET.
 *
 * The payload only says which run and who it was for. The run itself is read
 * back from Apify through the paying desk, which records its usageTotalUsd
 * under apify:<runId>: the same key the polling reader uses, so the run is
 * counted once whichever path sees it first. A delivery that cannot be
 * recorded answers 500 so Apify retries it.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const secret = Deno.env.get("COST_WEBHOOK_SECRET");
  if (!secret) return json({ error: "COST_WEBHOOK_SECRET is not set" }, 503);
  if (!sameToken(new URL(req.url).searchParams.get("secret") ?? "", secret)) return json({ error: "unauthorized" }, 401);

  let parsed;
  try {
    parsed = parseApifyWebhook(await req.json(), TOOL);
  } catch (e) {
    // A payload this app did not write: retrying would not help.
    console.warn(JSON.stringify({ event: "COST_WEBHOOK_REFUSED", reason: e instanceof Error ? e.message : String(e) }));
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }

  try {
    const res = await paid.fetch(parsed.ctx, "apify", `/v2/actor-runs/${parsed.runId}`);
    if (!res.ok) throw new Error(`Apify answered ${res.status} for run ${parsed.runId}`);
    const run = (await res.json())?.data ?? {};
    return json({ ok: true, run_id: parsed.runId, status: run.status ?? null, usage_usd: run.usageTotalUsd ?? null });
  } catch (e) {
    console.error(JSON.stringify({ event: "COST_WEBHOOK_FAILED", run_id: parsed.runId, feature: parsed.ctx.feature, error: e instanceof Error ? e.message : String(e) }));
    return json({ error: "could not record the run" }, 500);
  }
});
