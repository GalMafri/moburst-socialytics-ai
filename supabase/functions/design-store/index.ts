// supabase/functions/design-store/index.ts
//
// The design worker's door to the project's rows and files. The worker (a
// Python process on the Socialytics box, or wherever it runs) holds no Supabase
// key: it presents the project's server secret and the user it acts for, and
// this function does the reads and writes with the service role. One op per
// call: lease, extend, finish, profile, rules, prior, write_options, upload.
//
// Spec: docs/superpowers/specs/2026-10-08-design-engine-design.md, sections 11 and 14.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};
const BUCKET = "generated-media";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const caller = await requireStaff(req);
    // The worker is the project's own server: only the secret path may move runs and files.
    const { data: isAdmin } = caller.viaSecret ? { data: true } : await caller.asCaller.rpc("is_admin");
    if (!isAdmin) return json({ error: "The design store is the worker's and an admin's." }, 403);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "");
    const a = (body?.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;

    if (op === "lease") {
      const { data, error } = await admin.rpc("design_runs_lease", { p_lease_seconds: Number(a.seconds || 900) });
      if (error) return json({ error: error.message }, 500);
      return json({ run: Array.isArray(data) ? data[0] || null : data || null });
    }
    if (op === "extend") {
      const { error } = await admin.rpc("design_runs_extend", { p_run_id: String(a.run_id), p_lease_seconds: Number(a.seconds || 900) });
      if (error) return json({ error: error.message }, 500);
      if (a.plan && typeof a.plan === "object") await admin.from("design_runs").update({ plan: a.plan }).eq("id", String(a.run_id));
      return json({ ok: true });
    }
    if (op === "finish") {
      const patch: Record<string, unknown> = { status: String(a.status), spent: a.spent ?? {}, sizes: a.sizes ?? [], failure: a.failure ?? null,
        finished_at: new Date().toISOString(), lease_until: null };
      if (a.plan && typeof a.plan === "object") patch.plan = a.plan;
      const { error } = await admin.from("design_runs").update(patch).eq("id", String(a.run_id));
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (op === "profile") {
      const { data, error } = await admin.from("brand_profiles").select("profile, calibration, families, version")
        .eq("client_id", String(a.client_id)).eq("status", "confirmed").order("version", { ascending: false }).limit(1);
      if (error) return json({ error: error.message }, 500);
      return json({ profile: data?.[0] || null });
    }
    if (op === "rules") {
      const { data, error } = await admin.from("design_rules").select("text").eq("client_id", String(a.client_id)).eq("status", "active").order("created_at");
      if (error) return json({ error: error.message }, 500);
      return json({ rules: (data || []).map((r) => r.text) });
    }
    if (op === "prior") {
      const { data, error } = await admin.from("design_options").select("run_id, option_key, family_key, files, measurements")
        .eq("client_id", String(a.client_id)).in("status", ["offered", "picked"]).neq("kind", "slide")
        .order("created_at", { ascending: false }).limit(Number(a.limit || 3));
      if (error) return json({ error: error.message }, 500);
      return json({ prior: data || [] });
    }
    if (op === "write_options") {
      const rows = Array.isArray(a.rows) ? a.rows : [];
      if (!rows.length) return json({ ok: true, written: 0 });
      const { error } = await admin.from("design_options").insert(rows);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, written: rows.length });
    }
    if (op === "upload") {
      // base64 PNG in, public URL out; the path is designs/<client>/<run>/<name>
      const path = `designs/${String(a.client_id)}/${String(a.run_id)}/${String(a.name)}`;
      const bytes = Uint8Array.from(atob(String(a.base64 || "")), (c) => c.charCodeAt(0));
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: String(a.content_type || "image/png"), upsert: true });
      if (error) return json({ error: error.message }, 500);
      const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
      return json({ ok: true, path, url: data.publicUrl });
    }
    if (op === "seed_profile") {
      // The learner publishes a learned brand: one row per version, confirmed by the person named.
      const profile = (a.profile && typeof a.profile === "object" ? a.profile : null) as Record<string, unknown> | null;
      if (!profile) return json({ error: "profile is required" }, 400);
      const row = {
        client_id: String(a.client_id), version: Number(a.version || 1), status: a.confirmed ? "confirmed" : "draft",
        profile, calibration: profile.calibration ?? {}, families: profile.families ?? [], sources: a.sources ?? [],
        confirmed_by: a.confirmed ? caller.userId : null, confirmed_at: a.confirmed ? new Date().toISOString() : null,
      };
      const { data, error } = await admin.from("brand_profiles").upsert(row, { onConflict: "client_id,version" }).select("id, version, status").single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, profile: data });
    }
    if (op === "status") {
      const { data, error } = await admin.rpc("design_runs_status");
      if (error) return json({ error: error.message }, 500);
      return json({ status: data });
    }
    return json({ error: `unknown op ${op}` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
