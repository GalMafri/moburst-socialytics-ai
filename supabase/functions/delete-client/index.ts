// Hard-deletes a client and everything hanging off it.
//
// Every function here runs with verify_jwt = false, so this one authenticates
// its own caller. It shipped without that check: the id of a client was
// enough to erase it. Hard delete is admin-only by the same written decision
// that keeps staff to archiving (migration 20260505000001), so the guard is
// staff-with-write-access AND admin.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff, AuthzError } from "../_shared/auth/requireStaff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authenticate before touching anything, including before looking the
    // client up: an unauthenticated caller learns nothing, not even whether
    // the id exists.
    const { asCaller } = await requireStaff(req, { writeClientId: client_id });
    const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin");
    if (adminErr) throw new Error(`Access check failed: ${adminErr.message}`);
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Deleting a client permanently is an admin action. You can archive it instead." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get client info for storage cleanup
    const { data: client } = await supabase
      .from("clients")
      .select("name, brand_book_file_path, strategy_doc_file_path, design_references, harvested_design_references")
      .eq("id", client_id)
      .single();

    // Delete in dependency order
    await supabase.from("scheduled_posts").delete().eq("client_id", client_id);
    await supabase.from("report_schedules").delete().eq("client_id", client_id);
    await supabase.from("sprout_profiles").delete().eq("client_id", client_id);
    await supabase.from("client_users").delete().eq("client_id", client_id);
    await supabase.from("reports").delete().eq("client_id", client_id);
    // Competitive work hangs off the client too, and used to be left behind.
    await supabase.from("competitive_reports").delete().eq("client_id", client_id);
    await supabase.from("competitor_handles").delete().eq("client_id", client_id);
    await supabase.from("competitors").delete().eq("client_id", client_id);
    await supabase.from("competitor_sets").delete().eq("client_id", client_id);
    await supabase.from("post_iterations").delete().eq("client_id", client_id);
    await supabase.from("design_learnings").delete().eq("client_id", client_id);
    await supabase.from("clients").delete().eq("id", client_id);

    // Clean up storage
    const bookPaths = [client?.brand_book_file_path, (client as any)?.strategy_doc_file_path].filter(Boolean) as string[];
    if (bookPaths.length > 0) {
      await supabase.storage.from("brand-books").remove(bookPaths);
    }
    const refPaths = [
      ...(Array.isArray(client?.design_references) ? (client!.design_references as string[]) : []),
      ...(Array.isArray((client as any)?.harvested_design_references)
        ? ((client as any).harvested_design_references as Array<{ path?: string }>).map((r) => r?.path).filter(Boolean)
        : []),
    ] as string[];
    if (refPaths.length > 0) {
      await supabase.storage.from("design-references").remove(refPaths);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    if (error instanceof AuthzError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Error deleting client:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
