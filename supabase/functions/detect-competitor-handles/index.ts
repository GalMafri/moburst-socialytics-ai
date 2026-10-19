// Step 4: social handle and platform detection for a competitor set.
//
// For each competitor in the set (or one competitor when competitor_id is
// passed: the review screen's per-row lookup) this reads the competitor's
// website for the social profiles it links. The lookup lives in
// _shared/competitive/detectHandles.ts, which the client lifecycle's
// competitors step also runs. Rows a person edited keep what the person set
// (an upsert only fills gaps unless `refresh` is true).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { detectCompetitorHandles } from "../_shared/competitive/detectHandles.ts";

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
    const { set_id, competitor_id, refresh } = await req.json();
    if (!set_id && !competitor_id) {
      return jsonResp({ error: "set_id or competitor_id is required" }, 400);
    }

    // Staff gate FIRST, before any query, so unauthenticated callers learn
    // nothing (not even whether an id exists). The per-client write check
    // follows once the rows tell us which client this is.
    const caller = await requireStaff(req);
    const { asCaller } = caller;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let query = supabase.from("competitors").select("id, client_id, name, website_url");
    query = competitor_id ? query.eq("id", competitor_id) : query.eq("set_id", set_id);
    const { data: competitors, error: compErr } = await query;
    if (compErr) throw new Error(compErr.message);
    if (!competitors || competitors.length === 0) {
      return jsonResp({ error: "No competitors found" }, 404);
    }

    // All rows in a set share a client; company-scoped staff must be allowed
    // to write THIS client. The project's own server calls are trusted for every client.
    const { data: canWrite, error: writeErr } = caller.viaSecret ? { data: true, error: null } : await asCaller.rpc("can_write_client", {
      _client_id: competitors[0].client_id,
    });
    if (writeErr) throw new Error(`Access check failed: ${writeErr.message}`);
    if (!canWrite) return jsonResp({ error: "You do not have access to this client." }, 403);

    const { results, writeErrors } = await detectCompetitorHandles(supabase, competitors, { refresh: refresh === true });
    return jsonResp(writeErrors.length ? { results, write_errors: writeErrors } : { results });
  } catch (err: unknown) {
    if (err instanceof AuthzError) {
      return jsonResp({ error: err.message }, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[detect-competitor-handles]", msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
