// supabase/functions/design-pick/index.ts
//
// A client member or writing staff picks one offered design option for a post,
// or rejects one with an optional note. A pick becomes a post_iterations row
// carrying the option's files as media_urls, which is what the Schedule tab
// attaches to the Sprout post. Nothing here generates or judges a design.
//
// Spec: docs/superpowers/specs/2026-10-08-design-engine-design.md, sections 10, 12 and 13.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, bearerToken } from "../_shared/auth/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) throw new AuthzError(401, "Sign-in required.");
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await asCaller.auth.getUser(jwt);
    if (userErr || !userData?.user) throw new AuthzError(401, "Invalid or expired session.");

    const body = await req.json().catch(() => ({}));
    const optionId = String(body?.option_id || "");
    const action = body?.action === "reject" ? "reject" : "pick";
    const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
    if (!optionId) return json({ error: "option_id is required" }, 400);

    const { data: option, error: optErr } = await asCaller.from("design_options").select("*").eq("id", optionId).maybeSingle();
    if (optErr) return json({ error: optErr.message }, 500);
    if (!option) return json({ error: "That design option could not be found." }, 404);
    const { data: allowed, error: allowErr } = await asCaller.rpc("can_act_for_client", { _client_id: option.client_id });
    if (allowErr) return json({ error: `Access check failed: ${allowErr.message}` }, 500);
    if (!allowed) return json({ error: "You do not have access to this client." }, 403);
    if (option.status !== "offered" && !(action === "reject" && option.status === "picked")) {
      return json({ error: `This option was already ${option.status}.` }, 409);
    }

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: run } = await admin.from("design_runs").select("*").eq("id", option.run_id).maybeSingle();

    if (action === "reject") {
      const { error } = await admin.from("design_options").update({ status: "rejected", rejection_note: note }).eq("id", optionId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, status: "rejected" });
    }

    // The files a pick attaches: every size of a static, every slide (at the primary size) of a carousel, in slide order.
    const urls: string[] = [];
    if (option.kind === "carousel") {
      const { data: slides } = await admin.from("design_options").select("option_key, files").eq("run_id", option.run_id)
        .eq("parent_key", option.option_key).order("option_key");
      const primary = (run?.sizes?.[0]?.name as string | undefined) || null;
      for (const s of slides || []) {
        const files = (s.files || {}) as Record<string, { url?: string }>;
        const u = (primary && files[primary]?.url) || Object.values(files)[0]?.url;
        if (u) urls.push(u);
      }
    } else {
      for (const f of Object.values((option.files || {}) as Record<string, { url?: string }>)) if (f?.url) urls.push(f.url);
    }
    if (!urls.length) return json({ error: "This option has no files to attach." }, 409);

    const { data: iteration, error: itErr } = await admin.from("post_iterations").insert({
      client_id: option.client_id,
      report_id: run?.report_id || null,
      platform: run?.platform || null,
      post_copy: run?.copy || null,
      format: run?.format || null,
      source: "calendar",
      media_urls: urls,
      variant_angle: `Design option ${option.option_key} of run ${option.run_id}`,
      created_by: userData.user.id,
    }).select("id").single();
    if (itErr) return json({ error: itErr.message }, 500);

    const { error: upErr } = await admin.from("design_options").update({ status: "picked", picked_iteration_id: iteration.id }).eq("id", optionId);
    if (upErr) return json({ error: upErr.message }, 500);
    await admin.from("design_runs").update({ status: "picked" }).eq("id", option.run_id);
    return json({ ok: true, status: "picked", iteration_id: iteration.id, media_urls: urls });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
