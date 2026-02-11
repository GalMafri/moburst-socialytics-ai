import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
