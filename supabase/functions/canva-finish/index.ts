// supabase/functions/canva-finish/index.ts
//
// The Canva account link and job reads. Designs are made by design-worker
// since 13 Oct, so the finishing worker that used to live here (the drawn logo
// replaced by the client's logo file, copy set as layer edits) is gone.
//
//   GET  ?code=&state=                 the redirect back from Canva after connect
//   POST {action:"connect"}            admin: the URL to link the team's Canva account
//   POST {action:"connection"}         staff: whether Canva is linked
//   POST {action:"job", job_id}        staff: a job's state and finished file
//   advance, tick, prepare_upload and enqueue answer 410: designs are made by
//   design-worker without Canva.

import { createClient } from "../_shared/supabase.ts";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { PROVIDER, authorizeUrl, clientCredentials, exchangeCode, expiryFrom, makePkce, randomState } from "../_shared/canva/oauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};
const BUCKET = "generated-media";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://socialytics.moburst.com";
const PENDING_TTL_MS = 15 * 60 * 1000;
/** The Canva finishing worker and its inputs, retired on 13 Oct. */
const RETIRED_ACTIONS = new Set(["advance", "tick", "prepare_upload", "enqueue"]);

const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/canva-finish`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = db();
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.searchParams.get("code") || url.searchParams.get("error"))) {
      return await callback(admin, url);
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action || "connection";

    // Designs are made by design-worker without Canva since 13 Oct. The old
    // worker's actions answer without touching a job, so no design job can be
    // leased into the Canva steps again (41 jobs failed there on 13 Oct).
    if (RETIRED_ACTIONS.has(action)) return json({ retired: true, by: "design-worker" }, 410);

    if (action === "connect") {
      const { asCaller } = await requireStaff(req);
      const { data: isAdmin } = await asCaller.rpc("is_admin");
      if (!isAdmin) return json({ error: "Linking the team's Canva account is an admin action." }, 403);
      const { clientId } = clientCredentials();
      const { verifier, challenge } = await makePkce();
      const state = randomState();
      await admin.from("integration_tokens").upsert({
        provider: PROVIDER, client_id: clientId, pending_state: state, pending_verifier: verifier,
        pending_started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "provider" });
      return json({ authorize_url: authorizeUrl({ clientId, redirectUri: redirectUri(), challenge, state }), expires_in_minutes: PENDING_TTL_MS / 60000 });
    }

    if (action === "connection") {
      await requireStaff(req);
      const { data: row } = await admin.from("integration_tokens").select("refresh_token, linked_at, account_email").eq("provider", PROVIDER).maybeSingle();
      return json({ linked: !!row?.refresh_token, linked_at: row?.linked_at ?? null, account: row?.account_email ?? null });
    }

    if (action === "job") {
      await requireStaff(req);
      const { data: job } = await admin.from("canva_finish_jobs").select("*").eq("id", String(body.job_id || "")).maybeSingle();
      if (!job) return json({ error: "No such job." }, 404);
      const final_url = job.output_path ? admin.storage.from(BUCKET).getPublicUrl(job.output_path).data.publicUrl : null;
      return json({ job: { ...job, final_url } });
    }

    return json({ error: `Unknown action '${action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[canva-finish]", msg);
    return json({ error: msg }, 500);
  }
});

async function callback(admin: any, url: URL): Promise<Response> {
  if (url.searchParams.get("error")) return back("failed", "refused");
  const code = url.searchParams.get("code")!;
  const state = url.searchParams.get("state") || "";
  const { data: row } = await admin.from("integration_tokens").select("pending_state, pending_verifier, pending_started_at").eq("provider", PROVIDER).maybeSingle();
  if (!row?.pending_state || !row.pending_verifier || state !== row.pending_state) return back("failed", "bad_state");
  const startedAt = row.pending_started_at ? new Date(row.pending_started_at).getTime() : 0;
  if (!startedAt || Date.now() - startedAt > PENDING_TTL_MS) return back("failed", "expired");
  let grant;
  try {
    grant = await exchangeCode({ code, verifier: row.pending_verifier, redirectUri: redirectUri() });
  } catch (e) {
    console.error("[canva-finish] token exchange failed:", e instanceof Error ? e.message : e);
    return back("failed", "exchange_failed");
  }
  if (!grant.refresh_token) return back("failed", "no_refresh_token");
  let account: string | null = null;
  try {
    const me = await fetch("https://api.canva.com/rest/v1/users/me/profile", { headers: { Authorization: `Bearer ${grant.access_token}` } });
    account = (await me.json())?.profile?.display_name ?? null;
  } catch { account = null; }
  const { error } = await admin.from("integration_tokens").update({
    refresh_token: grant.refresh_token, access_token: grant.access_token, expires_at: expiryFrom(grant.expires_in),
    account_email: account, linked_at: new Date().toISOString(),
    pending_state: null, pending_verifier: null, pending_started_at: null, refreshing_until: null, updated_at: new Date().toISOString(),
  }).eq("provider", PROVIDER);
  if (error) return back("failed", "not_saved");
  return back("linked");
}

function back(status: "linked" | "failed", reason?: string): Response {
  const to = new URL("/settings", APP_ORIGIN);
  to.searchParams.set("canva", status);
  if (reason) to.searchParams.set("reason", reason);
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: to.toString() } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
