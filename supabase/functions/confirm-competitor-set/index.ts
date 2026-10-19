// Steps 5 and 6: a person confirms the competitor set on the Competitors screen.
//
// Staff deselect misfits, add manual competitors, and rank exactly three.
// This validates that state on the server and flips the set to 'confirmed',
// stamping who confirmed it (_shared/competitive/confirmSet.ts). It is the
// same rule the client lifecycle confirms by as the system: three ranked
// competitors. RivalIQ tracks companies by website, and the lifecycle's
// tracking step takes each company's profiles from RivalIQ, so a person's
// confirm never waits on how confident a profile search was.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { ConfirmError, confirmDraftSet } from "../_shared/competitive/confirmSet.ts";

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
    const { set_id, notes } = await req.json();
    if (!set_id) return jsonResp({ error: "set_id is required" }, 400);

    // Staff gate FIRST: an unauthenticated caller must not learn whether a
    // set id exists. Per-client authorization follows once the row is loaded.
    const caller = await requireStaff(req);
    const { userId, asCaller } = caller;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: set, error: setErr } = await supabase.from("competitor_sets").select("id, client_id, status").eq("id", set_id).maybeSingle();
    if (setErr || !set) return jsonResp({ error: "Set not found" }, 404);

    // The project's own server calls are trusted for every client.
    const { data: canWrite, error: writeErr } = caller.viaSecret ? { data: true, error: null } : await asCaller.rpc("can_write_client", {
      _client_id: set.client_id,
    });
    if (writeErr) throw new Error(`Access check failed: ${writeErr.message}`);
    if (!canWrite) return jsonResp({ error: "You do not have access to this client." }, 403);

    if (set.status !== "draft") {
      return jsonResp({ error: `Set is '${set.status}', only a draft can be confirmed.` }, 409);
    }

    const { selected } = await confirmDraftSet(supabase, set_id, { confirmedBy: userId, notes: typeof notes === "string" ? notes : null });
    return jsonResp({ ok: true, set_id, selected });
  } catch (err: unknown) {
    if (err instanceof AuthzError || err instanceof ConfirmError) {
      return jsonResp({ error: err.message }, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[confirm-competitor-set]", msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
