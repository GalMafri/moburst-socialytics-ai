// supabase/functions/derive-content-pillars/index.ts
//
// The client's content pillars, read rather than typed, for the setup page.
// The derivation lives in _shared/brand/pillars.ts, which the client
// lifecycle's brief_pillars step also runs. Nothing is written here: these
// are a proposal the page puts in the editable list, and a client whose
// pillars were written by hand never loses them to somebody pressing this.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { anthropicKey, derivePillars, PillarsError } from "../_shared/brand/pillars.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { client_id } = await req.json();
    if (!client_id) return json({ error: "client_id is required" }, 400);

    await requireStaff(req, { writeClientId: client_id });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, name, brief_text, brand_notes, website_url, social_keywords, competitor_seed_notes, strategy_doc_file_path, primary_platforms")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr || !client) return json({ error: "Client not found" }, 404);

    const apiKey = await anthropicKey(supabase);
    if (!apiKey) return json({ error: "Anthropic is not configured on this environment." }, 500);

    const derived = await derivePillars(supabase, client, apiKey);
    return json(derived);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    if (err instanceof PillarsError) return json({ error: err.message }, err.code === "no_evidence" ? 422 : 502);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[derive-content-pillars]", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
