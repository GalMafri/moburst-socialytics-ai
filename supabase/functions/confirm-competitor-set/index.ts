// Steps 5+6: the human confirmation gate.
//
// The review UI lets staff deselect misfits, add manual competitors, and rank
// exactly three. This function validates that state server-side and flips the
// set to 'confirmed', stamping who confirmed it. Downstream (the RivalIQ deep
// pull in Milestone 3) only ever consumes confirmed sets, so this is the
// gate that keeps half-reviewed AI output from reaching a client deliverable.
//
// Validation is intentionally strict: exactly 3 selected, ranks 1..3 with no
// gaps or duplicates, every selected competitor carrying at least one active
// social handle (an unreachable competitor can't be analyzed).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";

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

    // Staff gate FIRST — an unauthenticated caller must not learn whether a
    // set id exists. Per-client authorization follows once the row is loaded.
    const { userId, asCaller } = await requireStaff(req);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: set, error: setErr } = await supabase
      .from("competitor_sets")
      .select("id, client_id, status")
      .eq("id", set_id)
      .maybeSingle();
    if (setErr || !set) return jsonResp({ error: "Set not found" }, 404);

    const { data: canWrite, error: writeErr } = await asCaller.rpc("can_write_client", {
      _client_id: set.client_id,
    });
    if (writeErr) throw new Error(`Access check failed: ${writeErr.message}`);
    if (!canWrite) return jsonResp({ error: "You do not have access to this client." }, 403);

    if (set.status !== "draft") {
      return jsonResp({ error: `Set is '${set.status}', only a draft can be confirmed.` }, 409);
    }

    const { data: selected, error: selErr } = await supabase
      .from("competitors")
      .select("id, name, selected_rank")
      .eq("set_id", set_id)
      .eq("is_selected", true)
      .order("selected_rank", { ascending: true });
    if (selErr) throw new Error(selErr.message);

    if (!selected || selected.length !== 3) {
      return jsonResp(
        { error: `Exactly 3 competitors must be selected (found ${selected?.length ?? 0}).` },
        422,
      );
    }
    const ranks = selected.map((s) => s.selected_rank).sort();
    if (JSON.stringify(ranks) !== JSON.stringify([1, 2, 3])) {
      return jsonResp({ error: "Selected competitors must be ranked 1, 2 and 3." }, 422);
    }

    // Every selected competitor needs at least one active handle to analyze.
    const missing: string[] = [];
    for (const s of selected) {
      const { count } = await supabase
        .from("competitor_handles")
        .select("id", { count: "exact", head: true })
        .eq("competitor_id", s.id)
        .eq("is_active", true);
      if (!count) missing.push(s.name);
    }
    if (missing.length > 0) {
      return jsonResp(
        { error: `No active social handles for: ${missing.join(", ")}. Detect or add handles first.` },
        422,
      );
    }

    const { error: updErr } = await supabase
      .from("competitor_sets")
      .update({
        status: "confirmed",
        confirmed_by: userId,
        confirmed_at: new Date().toISOString(),
        notes: typeof notes === "string" ? notes.slice(0, 2000) : undefined,
      })
      .eq("id", set_id)
      .eq("status", "draft"); // guard against a concurrent confirm
    if (updErr) throw new Error(updErr.message);

    return jsonResp({ ok: true, set_id, selected });
  } catch (err: unknown) {
    if (err instanceof AuthzError) {
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
