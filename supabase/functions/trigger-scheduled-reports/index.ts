import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Find all active schedules that are due
    const { data: dueSchedules, error: fetchErr } = await supabase
      .from("report_schedules")
      .select("*, clients(*)")
      .eq("is_active", true)
      .lte("next_run_at", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    if (!dueSchedules || dueSchedules.length === 0) {
      return new Response(JSON.stringify({ message: "No schedules due", triggered: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get webhook URL
    const { data: setting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "n8n_webhook_url")
      .maybeSingle();

    if (!setting?.value) {
      return new Response(JSON.stringify({ error: "n8n webhook URL not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];

    for (const schedule of dueSchedules) {
      const client = schedule.clients;
      if (!client) continue;

      try {
        // Get active Sprout profiles
        const { data: profiles } = await supabase
          .from("sprout_profiles")
          .select("*")
          .eq("client_id", client.id)
          .eq("is_active", true);

        // Date range: current month
        const now = new Date();
        const dateRangeStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
        const dateRangeEnd = now.toISOString().split("T")[0];

        // Create report row
        const { data: report, error: reportErr } = await supabase
          .from("reports")
          .insert({
            client_id: client.id,
            status: "running",
            report_data: {},
            date_range_start: dateRangeStart,
            date_range_end: dateRangeEnd,
          })
          .select()
          .single();

        if (reportErr) throw reportErr;

        // Parse brand voice
        let brandNotes = client.brand_notes || "";
        let brandVoice = "";
        const voiceMatch = brandNotes.match(/^\[VOICE:(.+?)]\n?/);
        if (voiceMatch) {
          brandVoice = voiceMatch[1];
          brandNotes = brandNotes.slice(voiceMatch[0].length);
        }

        const geoArr = client.geo
          ? client.geo
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : ["US"];
        const langArr = client.language
          ? client.language
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : ["en"];

        // Build payload
        const payload = {
          report_id: report.id,
          client_name: client.name,
          sprout_customer_id: client.sprout_customer_id || "1676448",
          profile_ids: profiles?.map((p: any) => p.sprout_profile_id) || [],
          profiles:
            profiles?.map((p: any) => ({
              id: p.sprout_profile_id,
              name: p.profile_name,
              native_name: p.native_name,
              network: p.network_type,
              url: p.native_link,
            })) || [],
          social_keywords: client.social_keywords || [],
          trends_keywords: client.trends_keywords || "",
          content_pillars: client.content_pillars || [],
          primary_platforms: (client.primary_platforms || []).join(","),
          geo: geoArr,
          languages: langArr,
          brand_voice: brandVoice,
          brand_notes: brandNotes,
          brand_book_text: client.brand_book_text || "",
          brief_text: client.brief_text || "",
          brief_file_id: client.brief_file_id || "",
          date_range_start: dateRangeStart,
          date_range_end: dateRangeEnd,
        };

        // Fire webhook
        const response = await fetch(setting.value, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}`);
        }

        // Compute next run
        const nextRun = computeNextRun(schedule.frequency);

        // Update schedule
        await supabase
          .from("report_schedules")
          .update({
            last_run_at: new Date().toISOString(),
            next_run_at: nextRun,
          })
          .eq("id", schedule.id);

        results.push({
          client: client.name,
          report_id: report.id,
          status: "triggered",
          next_run_at: nextRun,
        });
      } catch (err: any) {
        results.push({
          client: client?.name || schedule.client_id,
          status: "error",
          error: err.message,
        });
      }
    }

    return new Response(JSON.stringify({ triggered: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function computeNextRun(frequency: string): string {
  const now = new Date();
  if (frequency === "weekly") {
    const next = new Date(now);
    next.setDate(now.getDate() + 7);
    next.setHours(9, 0, 0, 0);
    return next.toISOString();
  } else if (frequency === "biweekly") {
    const next = new Date(now);
    next.setDate(now.getDate() + 14);
    next.setHours(9, 0, 0, 0);
    return next.toISOString();
  } else {
    // monthly - 1st of next month
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0);
    return next.toISOString();
  }
}
