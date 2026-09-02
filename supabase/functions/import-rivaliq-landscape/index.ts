// List the account's RivalIQ landscapes for a client, or import one as a new
// competitor set (project step 5, the human-override half).
//
// The first live run proved the agency's RivalIQ landscapes ARE the curated
// competitor sets, so importing one is the fastest way to a confirmed set and
// keeps identification and analysis in agreement. Handles come straight from
// RivalIQ's tracked profiles (no scraping), and the set records the landscape
// id so the n8n workflow resolves it explicitly.
//
// One RivalIQ call per request (the account allows 1 concurrent / 100 per
// hour). Staff-gated FIRST, then per-client write check.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff, AuthzError } from "../_shared/auth/requireStaff.ts";
import { summarizeLandscapes } from "../_shared/competitive/rivaliqLandscape.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { client_id, mode, landscape_id } = await req.json();
    if (!client_id) return jsonResp({ error: "client_id is required" }, 400);
    if (mode !== "list" && mode !== "import") return jsonResp({ error: "mode must be 'list' or 'import'" }, 400);

    const { userId, asCaller } = await requireStaff(req);
    const { data: canWrite, error: writeErr } = await asCaller.rpc("can_write_client", { _client_id: client_id });
    if (writeErr) throw new Error(`Access check failed: ${writeErr.message}`);
    if (!canWrite) return jsonResp({ error: "You do not have access to this client." }, 403);

    const apiKey = Deno.env.get("RIVALIQ_API_KEY");
    if (!apiKey) return jsonResp({ error: "RivalIQ is not configured on this environment (RIVALIQ_API_KEY)." }, 500);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client, error: clientErr } = await supabase
      .from("clients").select("id, name").eq("id", client_id).maybeSingle();
    if (clientErr || !client) return jsonResp({ error: "Client not found" }, 404);

    const resp = await fetch(`https://api.rivaliq.com/v3/landscapes?apiKey=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return jsonResp({ error: `RivalIQ ${resp.status}: ${text.slice(0, 200)}` }, 502);
    }
    const body = await resp.json();
    const summaries = summarizeLandscapes(body.landscapes || [], client.name);

    if (mode === "list") return jsonResp({ client: client.name, landscapes: summaries });

    const chosen = summaries.find((l) => l.id === String(landscape_id));
    if (!chosen) return jsonResp({ error: "landscape_id not found on this RivalIQ account" }, 404);

    const { data: set, error: setErr } = await supabase
      .from("competitor_sets")
      .insert({
        client_id,
        status: "draft",
        source: "rivaliq",
        rivaliq_landscape_id: chosen.id,
        generated_by: userId,
        notes: `Imported from RivalIQ landscape "${chosen.name}"${chosen.focus_company ? ` (focus: ${chosen.focus_company})` : ""}.`,
      })
      .select("id")
      .single();
    if (setErr) throw new Error(setErr.message);

    const rivals = chosen.companies.filter((c) => !c.is_focus);
    let handleCount = 0;
    for (let i = 0; i < rivals.length; i++) {
      const c = rivals[i];
      const { data: comp, error: compErr } = await supabase
        .from("competitors")
        .insert({
          set_id: set.id,
          client_id,
          name: c.name,
          website_url: c.url,
          rationale: `Tracked in RivalIQ landscape "${chosen.name}".`,
          source: "manual",
          is_selected: i < 3,
          selected_rank: i < 3 ? i + 1 : null,
          rivaliq_company_id: c.id,
        })
        .select("id")
        .single();
      if (compErr) throw new Error(compErr.message);
      if (c.handles.length > 0) {
        const { error: hErr } = await supabase.from("competitor_handles").insert(
          c.handles.map((h) => ({
            competitor_id: comp.id, client_id, platform: h.platform, handle: h.handle,
            profile_url: h.profile_url, is_active: true, detection_confidence: 1,
          })),
        );
        if (hErr) throw new Error(hErr.message);
        handleCount += c.handles.length;
      }
    }

    return jsonResp({ set_id: set.id, landscape: chosen.name, competitors: rivals.length, handles: handleCount, preselected: Math.min(3, rivals.length) });
  } catch (err) {
    if (err instanceof AuthzError) return jsonResp({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[import-rivaliq-landscape]", msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
