// Step 3 of the competitive pipeline: AI competitor identification, for the
// Competitors screen. The identification lives in
// _shared/competitive/identify.ts, which the client lifecycle's competitors
// step also runs: a new draft set of 8 to 12 proposed competitors, each with
// a rationale and a similarity score, that staff can review.
//
// Handle detection is a separate function (detect-competitor-handles) so this
// call stays fast and so re-detection doesn't require re-identification.

import { createClient } from "../_shared/supabase.ts";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { IDENTIFY_COLUMNS, IdentifyError, identifyCompetitors } from "../_shared/competitive/identify.ts";
import { costCtx, hasKey } from "../_shared/paid/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id } = await req.json();
    if (!client_id) return jsonResp({ error: "client_id is required" }, 400);

    // Caller must be staff with write access to this client.
    const caller = await requireStaff(req, { writeClientId: client_id });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client, error: clientErr } = await supabase.from("clients").select(IDENTIFY_COLUMNS).eq("id", client_id).maybeSingle();
    if (clientErr || !client) return jsonResp({ error: "Client not found" }, 404);

    if (!(await hasKey("anthropic"))) return jsonResp({ error: "Anthropic API key not configured." }, 400);

    const cost = costCtx({ clientId: client_id, feature: "competitors.identify", actor: "user", userId: caller.userId });
    const result = await identifyCompetitors(supabase, client, cost);
    return jsonResp(result);
  } catch (err: unknown) {
    if (err instanceof AuthzError) return jsonResp({ error: err.message }, err.status);
    if (err instanceof IdentifyError && err.code === "too_few") return jsonResp({ error: err.message, rejected: err.rejected }, 422);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[identify-competitors]", msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
