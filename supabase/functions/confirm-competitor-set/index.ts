// Steps 5 and 6: a person confirms the competitor set on the Competitors screen.
//
// Staff deselect misfits, add manual competitors, and rank exactly three.
// This validates that state on the server and flips the set to 'confirmed',
// stamping who confirmed it (_shared/competitive/confirmSet.ts, the same
// confirmation the client lifecycle makes as the system). A person's confirm
// also needs every selected competitor to carry an active social handle a
// person or RivalIQ stands behind, or one found with high confidence.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { isReviewReadyHandle } from "../_shared/competitive/extractSocialHandles.ts";
import { checkedSelection, ConfirmError, confirmDraftSet } from "../_shared/competitive/confirmSet.ts";

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

    const selected = await checkedSelection(supabase, set_id);
    const missing: string[] = [];
    const unreviewed: string[] = [];
    for (const s of selected) {
      const { data: activeHandles, error: handlesErr } = await supabase
        .from("competitor_handles")
        .select("source, detection_confidence, is_active")
        .eq("competitor_id", s.id)
        .eq("is_active", true);
      if (handlesErr) throw new Error(`Could not verify handles for ${s.name}: ${handlesErr.message}`);
      if (!activeHandles?.length) missing.push(s.name);
      else if (!activeHandles.some(isReviewReadyHandle)) unreviewed.push(s.name);
    }
    if (missing.length > 0) {
      return jsonResp({ error: `No active social handles for: ${missing.join(", ")}. Detect or add handles first.` }, 422);
    }
    if (unreviewed.length > 0) {
      return jsonResp({ error: `Only low-confidence automatic profiles were found for: ${unreviewed.join(", ")}. Verify and add at least one profile manually before confirming.` }, 422);
    }

    await confirmDraftSet(supabase, set_id, { confirmedBy: userId, notes: typeof notes === "string" ? notes : null });
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
