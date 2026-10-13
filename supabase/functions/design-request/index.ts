// supabase/functions/design-request/index.ts
//
// Design options for a calendar post, for staff and for the client's own
// users.
//
//   POST {action:"create", client_id, report_id, calendar_post_key, platform, format, post_copy}
//        Plans the options from the post and the client's own posts, then
//        starts them. A second call while the post's designs are being
//        prepared returns the open request.
//   POST {action:"use", iteration_id}
//        Puts one finished design in use for its post; every other design of
//        that post stops being in use.
//
// Clients cannot write post_iterations directly (staff-only RLS), so using a
// design goes through here with the service role after a membership check.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { bearerToken } from "../_shared/auth/authz.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { BRIEFS_PLANNED, CAROUSEL_SLIDES, OPTIONS_WANTED, carouselPlannerPrompt, parseBriefs, parseCarouselBriefs, plannerPrompt } from "../_shared/canva/options.ts";
import { type DesignRequest, type Settings, startOption } from "../_shared/canva/jobs.ts";
import { wakeWorker } from "../_shared/canva/worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};
const PLANNER_MODEL = "claude-opus-5-5";

const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

/** Staff with write access to the client, or a signed-in member of the client. Returns the user id. */
async function requireMember(req: Request, clientId: string): Promise<string> {
  if (req.headers.get("x-socialytics-secret")) return (await requireStaff(req, { writeClientId: clientId })).userId;
  const jwt = bearerToken(req.headers.get("Authorization"));
  if (!jwt) throw new AuthzError(401, "Sign-in required.");
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
  });
  const { data: user, error } = await asCaller.auth.getUser(jwt);
  if (error || !user?.user) throw new AuthzError(401, "Invalid or expired session.");
  const [{ data: canWrite }, { data: member }] = await Promise.all([
    asCaller.rpc("can_write_client", { _client_id: clientId }),
    asCaller.rpc("is_client_member", { _client_id: clientId }),
  ]);
  if (!canWrite && !member) throw new AuthzError(403, "You do not have access to this client.");
  return user.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = service();
  try {
    const body = await req.json().catch(() => ({}));

    if (body?.action === "create") {
      const clientId = String(body.client_id || "");
      const postKey = String(body.calendar_post_key || "");
      const copy = String(body.post_copy || "").trim();
      if (!clientId || !postKey || !copy) return json({ error: "client_id, calendar_post_key and post_copy are required." }, 400);
      const userId = await requireMember(req, clientId);

      const { data: settings } = await admin.from("design_brand_settings").select("*").eq("client_id", clientId).maybeSingle();
      // Answered as a 200 so the screen can read the code (invoke() hides non-2xx bodies).
      if (!settings?.confirmed_at) return json({ code: "not_set_up" });

      const { data: open } = await admin.from("design_requests").select("*").eq("client_id", clientId).eq("calendar_post_key", postKey).eq("status", "preparing").maybeSingle();
      if (open) return json({ request: open });

      const { data: created, error } = await admin.from("design_requests").insert({
        client_id: clientId, report_id: body.report_id || null, calendar_post_key: postKey,
        platform: body.platform || null, format: body.format || null, post_copy: copy, requested_by: userId,
        kind: /carousel/i.test(String(body.format || "")) ? "carousel" : "single",
      }).select("*").single();
      if (error) {
        // Two clicks at once: the unique index let one through; answer with it.
        const { data: raced } = await admin.from("design_requests").select("*").eq("client_id", clientId).eq("calendar_post_key", postKey).eq("status", "preparing").maybeSingle();
        if (raced) return json({ request: raced });
        throw new Error(error.message);
      }

      // Planning takes a few seconds; the caller already has the request and
      // shows it as being prepared while this runs.
      const work = plan(admin, created as DesignRequest, settings as Settings).catch(async (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[design-request] planning failed:", msg);
        await admin.from("design_requests").update({ status: "needs_staff", error: msg, updated_at: new Date().toISOString() }).eq("id", created.id);
      });
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(work); else await work;
      return json({ request: created });
    }

    if (body?.action === "use") {
      const { data: it } = await admin.from("post_iterations").select("id, client_id, calendar_post_key, variant_group_id").eq("id", String(body.iteration_id || "")).maybeSingle();
      if (!it) return json({ error: "That design is no longer available." }, 404);
      await requireMember(req, it.client_id);
      if (it.calendar_post_key) {
        await admin.from("post_iterations").update({ is_selected: false }).eq("client_id", it.client_id).eq("calendar_post_key", it.calendar_post_key).neq("id", it.id);
      }
      const { error } = await admin.from("post_iterations").update({ is_selected: true }).eq("id", it.id);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    return json({ error: `Unknown action '${body?.action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[design-request]", msg);
    return json({ error: msg }, 500);
  }
});

/** Plan the options from the post and the client's own posts, then start the first ones. */
async function plan(admin: any, request: DesignRequest, settings: Settings): Promise<void> {
  const { data: client } = await admin.from("clients").select("name, brand_identity").eq("id", request.client_id).maybeSingle();
  const brand = client?.name ?? "the brand";
  const voice = client?.brand_identity?.tone_of_voice ?? null;

  const images = [];
  for (const path of settings.reference_paths) {
    const { data } = await admin.storage.from("design-references").download(path);
    if (!data) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const mediaType = /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg";
    images.push({ type: "image", source: { type: "base64", media_type: mediaType, data: btoa(bin) } });
  }
  if (!images.length) throw new Error("None of the client's reference posts could be read.");

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const carousel = request.kind === "carousel";
  const instruction = carousel
    ? carouselPlannerPrompt({ brand, platform: request.platform ?? "social", copy: request.post_copy, voice, count: BRIEFS_PLANNED, slides: CAROUSEL_SLIDES })
    : plannerPrompt({ brand, platform: request.platform ?? "social", copy: request.post_copy, voice, count: BRIEFS_PLANNED });
  let briefs = [] as ReturnType<typeof parseBriefs>;
  for (let attempt = 0; attempt < 2 && briefs.length < OPTIONS_WANTED; attempt++) {
    const result = await anthropicMessages({
      apiKey,
      body: {
        model: PLANNER_MODEL,
        max_tokens: carousel ? 6000 : 2000,
        messages: [{ role: "user", content: [...images, { type: "text", text: instruction }] }],
      },
    });
    briefs = carousel ? parseCarouselBriefs(result.text, CAROUSEL_SLIDES) : parseBriefs(result.text);
  }
  if (!briefs.length) throw new Error("The options could not be planned.");

  const planned: DesignRequest = { ...request, briefs };
  await admin.from("design_requests").update({ briefs, stage: "designing", updated_at: new Date().toISOString() }).eq("id", request.id);
  const first = Math.min(request.options_wanted, briefs.length);
  for (let i = 0; i < first; i++) await startOption(admin, planned, settings, brand, i, i);
  await admin.from("design_requests").update({ candidates_started: first, updated_at: new Date().toISOString() }).eq("id", request.id);
  await wakeWorker();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
