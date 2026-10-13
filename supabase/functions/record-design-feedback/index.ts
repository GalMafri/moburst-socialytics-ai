// Reject or archive a generated design, and learn from the rejection.
//
// Rejecting hides the variant and asks a small model to turn the reason and
// the note into one or two short "avoid"/"prefer" statements about this
// client's designs. generate-post-image and generate-post-video read those
// back into every later prompt, so a rejection changes the next result rather
// than just disappearing. Archiving hides without teaching — for a design that
// is fine but not wanted. Staff only, like approval.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { recordFeedback } from "../_shared/design-prompts/feedback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { iteration_id, verdict, reason, note } = await req.json();
    if (!iteration_id || !["rejected", "archived"].includes(verdict)) {
      return jsonResp({ error: "iteration_id and a verdict of rejected or archived are required" }, 400);
    }

    // Staff first, before any lookup: an unauthenticated caller must not learn
    // whether an id exists. The per-client write check follows once the row
    // says which client this is.
    const caller = await requireStaff(req);
    const { userId, asCaller } = caller;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: it, error: itErr } = await supabase
      .from("post_iterations")
      .select("id, client_id, platform, format, post_copy, visual_direction, variant_angle")
      .eq("id", iteration_id)
      .maybeSingle();
    if (itErr) throw new Error(itErr.message);
    if (!it) return jsonResp({ error: "Design not found" }, 404);

    const { data: canWrite, error: writeErr } = caller.viaSecret ? { data: true, error: null } : await asCaller.rpc("can_write_client", { _client_id: it.client_id });
    if (writeErr) throw new Error(`Access check failed: ${writeErr.message}`);
    if (!canWrite) return jsonResp({ error: "You do not have access to this client." }, 403);

    const learnings = await recordFeedback(supabase, it, verdict, reason, note, userId || null);

    return jsonResp({ ok: true, verdict, learnings });
  } catch (err: unknown) {
    if (err instanceof AuthzError) return jsonResp({ error: err.message }, err.status);
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
