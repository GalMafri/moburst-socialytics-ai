import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { handleSocialWrite } from "../_shared/reports/socialWriter.ts";

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

    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // The write itself is shared with the in-app social pipeline
    // (_shared/reports/socialWriter.ts), so both store a report the same way.
    const result = await handleSocialWrite(supabase, body);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
