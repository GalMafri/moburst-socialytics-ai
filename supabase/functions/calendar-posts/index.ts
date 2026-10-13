// supabase/functions/calendar-posts/index.ts
//
// The content calendar's posts (table calendar_posts), for staff and for the
// project's own schedules. Monthly reports plan posts into the calendar when
// they finish (update-report calls the same import); these actions cover
// existing reports and a report staff want to bring in again.
//
//   POST {action:"import_report", report_id}   staff with write access to the report's client
//   POST {action:"import_latest"}              operational secret: each client's latest finished report

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { importReportPosts } from "../_shared/calendar/fromReport.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};

const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = service();
  try {
    const body = await req.json().catch(() => ({}));

    if (body?.action === "import_report") {
      const { data: report } = await admin.from("reports").select("id, client_id, status").eq("id", String(body.report_id || "")).maybeSingle();
      if (!report) return json({ error: "No such report." }, 404);
      await requireStaff(req, { writeClientId: report.client_id });
      if (report.status !== "completed") return json({ error: "The report has not finished yet." }, 409);
      return json(await importReportPosts(admin, report.id));
    }

    if (body?.action === "import_latest") {
      const caller = await requireStaff(req);
      if (!caller.viaSecret) return json({ error: "Not allowed." }, 403);
      const { data: reports } = await admin.from("reports").select("id, client_id, created_at").eq("status", "completed").order("created_at", { ascending: false });
      const latest = new Map<string, string>();
      for (const r of reports ?? []) if (!latest.has(r.client_id)) latest.set(r.client_id, r.id);
      const results: Record<string, unknown> = {};
      for (const [clientId, reportId] of latest) {
        try { results[clientId] = await importReportPosts(admin, reportId); }
        catch (e) { results[clientId] = { error: e instanceof Error ? e.message : String(e) }; }
      }
      return json({ clients: latest.size, results });
    }

    return json({ error: `Unknown action '${body?.action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendar-posts]", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
