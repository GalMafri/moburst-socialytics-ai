import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretEquals } from "../_shared/auth/secretEquals.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only the n8n workflow may write reports: it sends the shared secret.
    // Anyone who knew a report id could overwrite it before this check.
    const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
    if (!(await secretEquals(req.headers.get("X-Socialytics-Secret"), secret))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { report_id, status, report_data, gamma_url, duration_minutes } =
      await req.json();

    if (!report_id) {
      return new Response(
        JSON.stringify({ error: "report_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (report_data !== undefined) updates.report_data = report_data;
    if (gamma_url !== undefined) updates.gamma_url = gamma_url;
    if (duration_minutes !== undefined) updates.duration_minutes = duration_minutes;

    // Every one of the 69 reports stored duration_minutes = 0, including a run
    // that took 34 minutes. The workflow's summary node reads a start time that
    // nothing ever writes, so it falls back to "now" at the moment the LAST
    // node runs and subtracts it from itself.
    //
    // Computing it here instead fixes both pipelines at once and uses the only
    // authoritative start there is: reports.created_at, which is set when the
    // row is created and reset on every re-run. A workflow that sends a real
    // number still wins; this only fills in the zero.
    if (!Number(duration_minutes)) {
      const { data: row } = await supabase
        .from("reports")
        .select("created_at")
        .eq("id", report_id)
        .maybeSingle();
      if (row?.created_at) {
        const minutes = Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000);
        // A clock skew or a re-used id could produce a negative or absurd
        // figure; better to leave it unset than to print a lie on the report.
        if (minutes >= 0 && minutes < 24 * 60) updates.duration_minutes = minutes;
      }
    }

    const { data, error } = await supabase
      .from("reports")
      .update(updates)
      .eq("id", report_id)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(data[0]), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
