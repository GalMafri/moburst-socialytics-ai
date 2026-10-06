// The competitor feed page's refresh (staff, scoped to the client) and the
// shared-secret caller. The refresh itself lives in
// _shared/competitive/refreshFeed.ts, which the scheduled-jobs worker also runs
// in-process for the weekly refresh.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FeedRefreshError, refreshCompetitorFeed } from "../_shared/competitive/refreshFeed.ts";
import { requireStaff } from "../_shared/auth/requireStaff.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const clientId = String(body.client_id || "");
    const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
    const viaSecret = await secretEquals(req.headers.get("X-Socialytics-Secret"), secret);
    if (!clientId) return json({ error: "client_id is required" }, 400);
    // Scoped to the client, not merely to staff. This was the only competitive
    // function that checked the role and not the client, so a company-scoped
    // staff member could pull any client's competitor feed.
    if (!viaSecret) await requireStaff(req, { writeClientId: clientId });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const result = await refreshCompetitorFeed(admin, clientId, {
      rivaliqKey: Deno.env.get("RIVALIQ_API_KEY"),
      anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
      secret,
      days: body.days,
    });
    return json(result);
  } catch (err: any) {
    if (err instanceof FeedRefreshError) return json(err.code ? { code: err.code, error: err.message } : { error: err.message }, err.status);
    const status = typeof err?.status === "number" ? err.status : 500;
    console.error("[refresh-competitor-feed]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
