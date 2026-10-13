// supabase/functions/canva-finish/index.ts
//
// Finishes a generated design in Canva: the drawn logo is replaced by the
// client's logo file and the copy is set exactly, as layer edits rather than
// pixel work (rules in _shared/canva/finish.ts).
//
// Runs entirely on Socialytics' own Canva developer app and a team Canva
// account linked once by an admin. Nothing here needs a person's machine or
// anyone's Claude account.
//
//   GET  ?code=&state=                 the redirect back from Canva after connect
//   POST {action:"connect"}            admin: the URL to link the team's Canva account
//   POST {action:"connection"}         staff: whether Canva is linked
//   POST {action:"prepare_upload", client_id, files:[name]}   staff: signed upload URLs for inputs
//   POST {action:"enqueue", client_id, design_path, logo_path, copy:[..], placement:{..}}   staff: queue a design
//   POST {action:"job", job_id}        staff: a job's state and finished file
//   POST {action:"tick"}               the minute worker (operational secret only)
//
// Each design is a row in canva_finish_jobs that moves through these steps,
// one or more per tick. Canva's jobs are started on one tick and checked on
// the next, so no request waits on Canva.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { PROVIDER, accessTokenFor, authorizeUrl, clientCredentials, exchangeCode, expiryFrom, makePkce, randomState } from "../_shared/canva/oauth.ts";
import { getExport, getImageToDesign, startExport, startImageToDesign, uploadAsset } from "../_shared/canva/rest.ts";
import { CanvaMcp } from "../_shared/canva/mcp.ts";
import { settleRequest } from "../_shared/canva/jobs.ts";
import { type Box, type Layer, type Placement, copyOperations, elementBox, inkBox, logoRect, pickLogoLayers, placementRegion } from "../_shared/canva/finish.ts";
import { type GenerateInput, canvasLogoRect, designPrompt, resampleRGBA } from "../_shared/canva/brief.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};
const BUCKET = "generated-media";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://socialytics.moburst.com";
const PENDING_TTL_MS = 15 * 60 * 1000;
const TICK_BUDGET_MS = 50_000;
const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 4;
const INTENT = "Socialytics finishing: replace the drawn logo with the client's logo file and set the post's exact copy";
/** The image model can take minutes; its run is held under a longer lease. */
const GENERATE_LEASE_MS = 420_000;
const MAX_GENERATIONS = 3;
const PAGE = { width: 1088, height: 1360 };

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

    if (action === "tick") {
      if (!(await secretEquals(req.headers.get("x-socialytics-secret") ?? "", Deno.env.get("SOCIALYTICS_N8N_SECRET")))) {
        return json({ error: "Not allowed." }, 401);
      }
      return json(await tick(admin));
    }

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

    if (action === "prepare_upload") {
      const clientId = String(body.client_id || "");
      await requireStaff(req, { writeClientId: clientId });
      const files: string[] = Array.isArray(body.files) ? body.files.map(String) : [];
      if (!clientId || !files.length) return json({ error: "client_id and files are required." }, 400);
      const batch = crypto.randomUUID();
      const uploads = [];
      for (const name of files) {
        const path = `${clientId}/canva-finish/inputs/${batch}/${name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error) throw new Error(`Could not prepare ${name}: ${error.message}`);
        uploads.push({ name, path, upload_url: data.signedUrl });
      }
      return json({ uploads });
    }

    if (action === "enqueue") {
      const clientId = String(body.client_id || "");
      const caller = await requireStaff(req, { writeClientId: clientId });
      const placement = body.placement as Placement;
      const copy: string[] = Array.isArray(body.copy) ? body.copy.map(String) : [];
      const generate = body.generate as GenerateInput | undefined;
      if (generate && (!generate.concept || !generate.background || !Array.isArray(generate.refs) || !generate.refs.length || !generate.brand_name || !generate.platform)) {
        return json({ error: "generate needs brand_name, platform, concept, background and refs." }, 400);
      }
      if (!clientId || (!body.design_path && !generate) || !body.logo_path || !copy.length || !placement?.anchor) {
        return json({ error: "client_id, logo_path, copy, placement and either design_path or generate are required." }, 400);
      }
      const logo = await download(admin, String(body.logo_path));
      const [lw, lh] = pngSize(logo);
      const { data, error } = await admin.from("canva_finish_jobs").insert({
        client_id: clientId, created_by: caller.userId,
        step: generate ? "generate" : "upload",
        input: { design_path: body.design_path ?? null, logo_path: body.logo_path, logo_size: [lw, lh], copy, placement, generate: generate ?? null, title: body.title ?? null },
      }).select("id").single();
      if (error) throw new Error(error.message);
      return json({ job_id: data.id });
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

// ── The worker ──────────────────────────────────────────────────────────────

/**
 * Canva's editing service fails when one account holds several editing
 * sessions at once (the first live run, one design at a time, had no errors;
 * three at once failed two). Steps that edit run through this queue, one at a
 * time; uploads, Magic Layers and exports still run side by side.
 */
let editQueue: Promise<unknown> = Promise.resolve();
function oneEditAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = editQueue.then(fn, fn);
  editQueue = run.catch(() => undefined);
  return run;
}

/**
 * One Canva editing session per tick, shared by the queued edits and closed
 * when the tick ends. Opening a new session per step (and never closing it)
 * left sessions piling up on the account, and Canva refused new ones.
 */
let tickMcp: CanvaMcp | null = null;
async function editingSession(token: string): Promise<CanvaMcp> {
  if (!tickMcp) tickMcp = new CanvaMcp(token);
  if (!tickMcp.ready) await tickMcp.init();
  return tickMcp;
}
async function closeEditingSession(): Promise<void> {
  const m = tickMcp;
  tickMcp = null;
  if (m) await m.close();
}

type Job = { id: string; client_id: string; step: string; status: string; attempts: number; input: any; state: any; design_request_id: string | null; option_index: number | null; slide_index: number | null; slide_count: number | null };
/** next: run the following step now; wait: check again next tick; held: work continues in the background under its lease. */
type StepResult = "next" | "wait" | "done" | "held";

async function tick(admin: any) {
  const started = Date.now();
  const { data: due } = await admin.from("canva_finish_jobs").select("id")
    .in("status", ["queued", "running"])
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order("created_at").limit(10);
  if (!due?.length) {
    await settleOpenRequests(admin, new Set());
    return { ran: 0 };
  }

  const token = await accessTokenFor(admin);
  // Lease every due job, then advance them side by side: most of a step is
  // waiting on Canva, so one design's wait should not hold up the others.
  const leased: Job[] = [];
  for (const { id } of due) {
    const now = new Date();
    const { data: claimed } = await admin.from("canva_finish_jobs")
      .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString(), status: "running", updated_at: now.toISOString() })
      .eq("id", id).in("status", ["queued", "running"])
      .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
      .select("id, client_id, step, status, attempts, input, state, design_request_id, option_index, slide_index, slide_count");
    if (claimed?.[0]) leased.push(claimed[0]);
  }
  const outcomes = await Promise.all(leased.map((job) => advance(admin, token, job, started)));
  const settled = new Set<string>();
  for (const job of leased) {
    if (!job.design_request_id || settled.has(job.design_request_id)) continue;
    settled.add(job.design_request_id);
    await settleRequest(admin, job.design_request_id).catch((e) => console.error(`[canva-finish] request ${job.design_request_id}:`, e instanceof Error ? e.message : e));
  }
  await settleOpenRequests(admin, settled);
  await closeEditingSession();
  return { ran: leased.length, report: Object.fromEntries(leased.map((job, i) => [job.id, outcomes[i]])) };
}

/**
 * Requests whose jobs all ended outside this tick (an option generated in the
 * background, or a replacement still to start) are settled here too, so a
 * request never waits on a job that is no longer running.
 */
async function settleOpenRequests(admin: any, skip: Set<string>): Promise<void> {
  const { data: open } = await admin.from("design_requests").select("id, updated_at").eq("status", "preparing").neq("stage", "planning");
  for (const r of open ?? []) {
    if (skip.has(r.id)) continue;
    await settleRequest(admin, r.id).catch((e) => console.error(`[canva-finish] request ${r.id}:`, e instanceof Error ? e.message : e));
  }
}

/** Run one leased job's steps until it waits on Canva, finishes, or the tick runs out of time. */
async function advance(admin: any, token: string, job: Job, started: number): Promise<string> {
  try {
    let result: StepResult = "next";
    while (result === "next" && Date.now() - started < TICK_BUDGET_MS) {
      result = await runStep(admin, token, job, started + TICK_BUDGET_MS);
      await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    }
    if (result === "done") {
      await admin.from("canva_finish_jobs").update({ status: "done", output_path: job.state.final_path, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return "done";
    }
    if (result !== "held") await admin.from("canva_finish_jobs").update({ lease_until: null }).eq("id", job.id);
    return job.step;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = job.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS || msg.startsWith("FINAL:");
    console.error(`[canva-finish] job ${job.id} step ${job.step}:`, msg);
    await admin.from("canva_finish_jobs").update({
      attempts, error: msg.replace(/^FINAL:\s*/, ""), status: failed ? "failed" : "running", lease_until: null, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return failed ? "failed" : `retry ${job.step}`;
  }
}

async function runStep(admin: any, token: string, job: Job, deadline: number): Promise<StepResult> {
  const s = job.state;
  const base = `${job.client_id}/canva-finish/${job.id}`;
  switch (job.step) {
    case "generate": {
      // A carousel slide after the cover follows the cover's look, so it waits
      // for the cover's design; if the cover cannot be made, neither can it.
      if (job.slide_index && job.slide_index > 0) {
        const { data: cover } = await admin.from("canva_finish_jobs").select("status, state").eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).eq("slide_index", 0).maybeSingle();
        if (!cover || cover.status === "failed") throw new Error("FINAL: The carousel's cover could not be made.");
        if (!cover.state?.design_path) return "wait";
        s.cover_path = cover.state.design_path;
      }
      s.generations = (s.generations ?? 0) + 1;
      if (s.generations > MAX_GENERATIONS) throw new Error("FINAL: The design could not be generated.");
      await admin.from("canva_finish_jobs").update({ lease_until: new Date(Date.now() + GENERATE_LEASE_MS).toISOString(), state: s }).eq("id", job.id);
      const work = generateDesign(admin, job).catch(async (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[canva-finish] job ${job.id} generate:`, msg);
        await admin.from("canva_finish_jobs").update({ error: msg, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      });
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
      else await work;
      return "held";
    }
    case "upload": {
      s.design_asset = await uploadAsset(token, await download(admin, s.design_path ?? job.input.design_path), `${job.id}-design.png`);
      s.logo_asset = await uploadAsset(token, await download(admin, job.input.logo_path), `${job.id}-logo.png`);
      job.step = "layers"; return "next";
    }
    case "layers": {
      s.layers_job = await startImageToDesign(token, s.design_asset, job.input.title || `Socialytics ${job.id}`);
      job.step = "layers_wait"; return "next";
    }
    case "layers_wait": {
      const r = await settle(() => getImageToDesign(token, s.layers_job), deadline);
      if (r.status === "in_progress") return "wait";
      if (r.status !== "success" || !r.designId) throw new Error(`FINAL: Magic Layers did not finish: ${r.error ?? r.status}`);
      s.design_id = r.designId; job.step = "export_before"; return "next";
    }
    case "export_before":
    case "export_nologo":
    case "export_final": {
      if (!s.page) {
        s.page = await oneEditAtATime(async () => {
          const mcp = await editingSession(token);
          const tx = await mcp.call("start-editing-transaction", { design_id: s.design_id, user_intent: INTENT });
          await mcp.call("cancel-editing-transaction", { transaction_id: tx.transaction.transaction_id, user_intent: INTENT }).catch(() => {});
          return { id: tx.pages[0].page_id, width: tx.pages[0].dimension.width, height: tx.pages[0].dimension.height };
        });
      }
      s.export_job = await startExport(token, s.design_id, s.page.width, s.page.height);
      job.step = `${job.step}_wait`; return "next";
    }
    case "export_before_wait":
    case "export_nologo_wait":
    case "export_final_wait": {
      const r = await settle(() => getExport(token, s.export_job), deadline);
      if (r.status === "in_progress") return "wait";
      if (r.status !== "success" || !r.url) throw new Error(`Export did not finish: ${r.error ?? r.status}`);
      const which = job.step.replace(/^export_/, "").replace(/_wait$/, "");
      const bytes = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
      const path = `${base}/${which}.png`;
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`Could not store the ${which} export: ${error.message}`);
      s[`${which}_path`] = path;
      job.step = which === "before" ? "edit" : which === "nologo" ? "place_logo" : "finished";
      return which === "final" ? "done" : "next";
    }
    case "edit": return await oneEditAtATime(() => editLayers(token, job));
    case "place_logo": return await oneEditAtATime(() => placeLogo(admin, token, job));
  }
  throw new Error(`FINAL: Unknown step '${job.step}'`);
}

/** Delete the drawn logo's layers and set the exact copy, in one Canva editing session. */
async function editLayers(token: string, job: Job): Promise<StepResult> {
  const s = job.state;
  {
      const mcp = await editingSession(token);
      const tx = await mcp.call("start-editing-transaction", { design_id: s.design_id, user_intent: INTENT });
      const tid = tx.transaction.transaction_id;
      const texts: Layer[] = (tx.richtexts ?? []).map((r: any) => ({ id: r.element_id, box: elementBox(r), text: (r.regions ?? []).map((g: any) => g.text ?? "").join("") }));
      const fills: Layer[] = (tx.fills ?? []).map((f: any) => ({ id: f.element_id, box: elementBox(f) }));
      const [lw, lh] = job.input.logo_size;
      const region = placementRegion(job.input.placement, lw, lh, s.page.width, s.page.height);
      const logo = pickLogoLayers([...texts, ...fills], region, job.input.copy);
      const copyTexts = texts.filter((t) => !logo.includes(t));
      const copy = copyOperations(copyTexts, job.input.copy);
      if ("error" in copy) {
        await mcp.call("cancel-editing-transaction", { transaction_id: tid, user_intent: INTENT }).catch(() => {});
        throw new Error(`FINAL: ${copy.error}`);
      }
      const ops = [...logo.map((l) => ({ type: "delete_element", element_id: l.id })), ...copy.ops];
      // A retried step can find the logo already gone (the previous attempt
      // committed before it could record it); the client's logo region then
      // bounds the search for where it was.
      s.logo_boxes = logo.length ? logo.map((l) => l.box) : [region];
      if (ops.length) {
        await mcp.call("perform-editing-operations", { transaction_id: tid, page_index: 1, pages: tx.pages, operations: ops, user_intent: INTENT });
        await mcp.call("commit-editing-transaction", { transaction_id: tid, user_intent: INTENT });
      } else {
        await mcp.call("cancel-editing-transaction", { transaction_id: tid, user_intent: INTENT }).catch(() => {});
      }
      s.edits = { deleted: logo.map((l) => l.id), copy: copy.ops.map((o) => o.text) };
      job.step = "export_nologo"; return "next";
  }
}

/** Place the client's logo file where the drawn logo was, in one Canva editing session. */
async function placeLogo(admin: any, token: string, job: Job): Promise<StepResult> {
  const s = job.state;
  {
      const before = await Image.decode(await download(admin, s.before_path));
      const after = await Image.decode(await download(admin, s.nologo_path));
      const ink: Box | null = inkBox(before.bitmap, after.bitmap, before.width, before.height, s.logo_boxes);
      if (!ink) throw new Error("FINAL: The design has no drawn logo where the client's logo goes.");
      const [lw, lh] = job.input.logo_size;
      const rect = logoRect(ink, lw, lh);
      s.logo_rect = rect;
      const mcp = await editingSession(token);
      const tx = await mcp.call("start-editing-transaction", { design_id: s.design_id, user_intent: INTENT });
      // A retried step must not place a second logo when the first attempt
      // committed before it could record that it had.
      if ((tx.fills ?? []).some((f: any) => f.asset_id === s.logo_asset)) {
        await mcp.call("cancel-editing-transaction", { transaction_id: tx.transaction.transaction_id, user_intent: INTENT }).catch(() => {});
        job.step = "export_final"; return "next";
      }
      await mcp.call("perform-editing-operations", {
        transaction_id: tx.transaction.transaction_id, page_index: 1, pages: tx.pages, user_intent: INTENT,
        operations: [{ type: "insert_fill", page_id: s.page.id, asset_type: "image", asset_id: s.logo_asset, alt_text: "Logo", ...rect }],
      });
      await mcp.call("commit-editing-transaction", { transaction_id: tx.transaction.transaction_id, user_intent: INTENT });
      job.step = "export_final"; return "next";
  }
}

/**
 * Design the post with the image model: the client's background colour with
 * its logo file locked at the habitual spot (a mask shaped like the logo's
 * letters), three of the client's own posts as references, and the brief from
 * _shared/canva/brief.ts. The result is stored and handed to the upload step.
 */
async function generateDesign(admin: any, job: Job): Promise<void> {
  const g: GenerateInput = job.input.generate;
  const base = `${job.client_id}/canva-finish/${job.id}`;
  const file = await Image.decode(await download(admin, job.input.logo_path));
  const rect = canvasLogoRect(job.input.placement, file.width, file.height, PAGE.width, PAGE.height);
  const logo = new Image(rect.width, rect.height);
  logo.bitmap.set(resampleRGBA(file.bitmap, file.width, file.height, rect.width, rect.height));

  const [r, gr, b] = hexRgb(g.background);
  const canvas = new Image(PAGE.width, PAGE.height).fill(Image.rgbaToColor(r, gr, b, 255));
  canvas.composite(logo, rect.x, rect.y);
  const slide = job.slide_count && job.slide_count > 1
    ? { index: job.slide_index ?? 0, count: job.slide_count, withCover: !!job.state.cover_path }
    : undefined;
  // OpenAI's mask: transparent pixels are redrawn, opaque ones are kept. Only
  // the logo's own ink is opaque, so no box appears behind it.
  const mask = new Image(PAGE.width, PAGE.height);
  for (let y = 0; y < logo.height; y++) {
    for (let x = 0; x < logo.width; x++) {
      if (logo.bitmap[(y * logo.width + x) * 4 + 3] === 0) continue;
      const tx = x + rect.x, ty = y + rect.y;
      if (tx < 0 || ty < 0 || tx >= PAGE.width || ty >= PAGE.height) continue;
      mask.bitmap.set([255, 255, 255, 255], (ty * PAGE.width + tx) * 4);
    }
  }

  const form = new FormData();
  form.append("model", "gpt-image-2.5-flare");
  form.append("size", `${PAGE.width}x${PAGE.height}`);
  form.append("quality", "high");
  form.append("n", "1");
  form.append("image[]", new Blob([(await canvas.encode()) as unknown as BlobPart], { type: "image/png" }), "canvas.png");
  if (slide?.withCover) form.append("image[]", new Blob([(await download(admin, job.state.cover_path)) as unknown as BlobPart], { type: "image/png" }), "cover.png");
  for (const [i, path] of g.refs.entries()) {
    const { data, error } = await admin.storage.from("design-references").download(path);
    if (error || !data) throw new Error(`Could not read the client post ${path}: ${error?.message ?? "missing"}`);
    form.append("image[]", data, `ref${i}${path.slice(path.lastIndexOf("."))}`);
  }
  form.append("mask", new Blob([(await mask.encode()) as unknown as BlobPart], { type: "image/png" }), "mask.png");
  form.append("prompt", designPrompt(g, job.input.copy, g.refs.length, slide));

  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${await openaiKey(admin)}` },
    body: form,
    signal: AbortSignal.timeout(360_000),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Image model ${resp.status}: ${text.slice(0, 300)}`);
  const b64 = JSON.parse(text)?.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image model returned no image.");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const path = `${base}/design.png`;
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Could not store the design: ${error.message}`);

  const state = { ...job.state, design_path: path };
  await admin.from("canva_finish_jobs").update({ step: "upload", state, error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
}

async function openaiKey(admin: any): Promise<string> {
  const fromEnv = Deno.env.get("OPENAI_API_KEY");
  if (fromEnv) return fromEnv;
  const { data } = await admin.from("app_settings").select("value").eq("key", "openai_api_key").maybeSingle();
  if (!data?.value) throw new Error("FINAL: No OpenAI key is configured.");
  return data.value as string;
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`FINAL: '${hex}' is not a colour like #0B0E1A.`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Check a Canva job until it leaves in_progress or this tick runs low on time.
 * Exports finish in seconds and Magic Layers in under a minute; leaving each
 * check to the next minute's tick added minutes to every design.
 */
async function settle<T extends { status: string }>(check: () => Promise<T>, deadline: number): Promise<T> {
  let r = await check();
  while (r.status === "in_progress" && Date.now() + 2500 < deadline) {
    await new Promise((res) => setTimeout(res, 2000));
    r = await check();
  }
  return r;
}

async function download(admin: any, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not read ${path}: ${error?.message ?? "missing"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** A PNG's pixel size from its header. */
function pngSize(bytes: Uint8Array): [number, number] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || v.getUint32(0) !== 0x89504e47) throw new Error("The logo must be a PNG file.");
  return [v.getUint32(16), v.getUint32(20)];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
