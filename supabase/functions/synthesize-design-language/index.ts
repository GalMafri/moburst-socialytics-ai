import { requireStaff } from "../_shared/auth/requireStaff.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { learnBrandStyle } from "../_shared/brand-references/learnStyle.ts";
import { StyleError } from "../_shared/brand-references/errors.ts";

// A person asking for the style to be learned now: from uploaded references
// and a brand book (Client Setup), or from the client's published posts (the
// API demo). The client lifecycle runs the same code on the server on its own
// (_shared/lifecycle), so no page needs to call this to keep a client current.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const STATUS: Record<string, number> = { no_accounts: 422, too_few: 422, no_sources: 400, accounts_changed: 409, provider: 502 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { client_id, discover = false, force = false } = await req.json();
    if (!client_id) return json({ error: "Choose a client." }, 400);
    await requireStaff(req, { writeClientId: client_id });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const learned = await learnBrandStyle(db, client_id, { discover: discover === true, force: force === true });
    return json({
      design_style_synthesis: learned.synthesis,
      ...(learned.refs ? { harvested_design_references: learned.refs } : {}),
      ...(learned.cached ? { cached: true } : {}),
    });
  } catch (e) {
    if (e instanceof StyleError) return json({ error: e.message, code: e.code }, STATUS[e.code] ?? 500);
    // deno-lint-ignore no-explicit-any
    const status = typeof (e as any)?.status === "number" ? (e as any).status : 500;
    console.error("[synthesize-design-language]", e);
    return json({ error: status === 500 ? "The style could not be learned. Try again." : (e instanceof Error ? e.message : "Not allowed.") }, status);
  }
});
