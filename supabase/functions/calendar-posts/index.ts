// supabase/functions/calendar-posts/index.ts
//
// The content calendar's actions (weekly calendar, Lital 19 Oct 2026). Plans
// are made once per week by the scheduled jobs (_shared/calendar/runWeek.ts):
// every Monday for the following week, or when someone asks here.
//
//   POST {action:"plan_next_week", client_id}
//        a member of the client or staff: plan the earliest week without a
//        plan, from this week up to four weeks ahead
//   POST {action:"revise_week", plan_id, note}
//        a member of the client or staff: rewrite the week's posts nobody
//        worked on, following the note (the note also teaches the memory)
//   POST {action:"save_copy", client_id, calendar_post_key, post_copy, ...}
//        a member of the client or staff: save a copy edit (a revision row
//        without media) and update the calendar post; a person's edit
//        teaches the client's preference memory
//   POST {action:"preview_evidence", client_id}
//        staff with write access: what the planner would see for this client
//        now (rhythm, scored evidence, thin data), with no model call
//   POST {action:"consolidate_memory", client_id}
//        staff with write access, or the operational secret: merge the
//        client's preferences learned before the memory merged them

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { requireMember } from "../_shared/auth/requireMember.ts";
import { consolidateMemory, learnFromSignal } from "../_shared/voice/load.ts";
import { CLIENT_COLUMNS, gatherEvidence } from "../_shared/calendar/runWeek.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** How far ahead "Plan next week" goes: a month. */
const WEEKS_AHEAD = 4;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};

const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function background(work: Promise<unknown>, label: string) {
  const guarded = work.catch((e) => console.warn(`[calendar-posts] ${label}:`, e instanceof Error ? e.message : e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(guarded);
}

function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = service();
  try {
    const body = await req.json().catch(() => ({}));

    if (body?.action === "plan_next_week") {
      const clientId = String(body.client_id || "");
      if (!clientId) return json({ error: "client_id is required." }, 400);
      const userId = await requireMember(req, clientId);
      const { data: client } = await admin.from("clients").select("timezone").eq("id", clientId).maybeSingle();
      if (!client) return json({ error: "No such client." }, 404);
      const tomorrow = addDays(todayIn(String(client.timezone || "UTC")), 1);
      const thisWeek = mondayOf(todayIn(String(client.timezone || "UTC")));
      const weeks = Array.from({ length: WEEKS_AHEAD + 1 }, (_, i) => addDays(thisWeek, i * 7)).filter((w) => addDays(w, 6) >= tomorrow);
      const { data: plans } = await admin.from("calendar_plans").select("week_start, status").eq("client_id", clientId).in("week_start", weeks);
      const held = new Map((plans ?? []).map((p: { week_start: string; status: string }) => [p.week_start, p.status]));
      const week = weeks.find((w) => !held.has(w) || held.get(w) === "failed");
      if (!week) return json({ error: "The next four weeks are already planned." }, 409);
      const { data: plan, error } = await admin.rpc("calendar_request_week", { p_client: clientId, p_week: week, p_trigger: "button", p_user: userId });
      if (error) return json({ error: error.message }, 409);
      return json({ plan, week }, 202);
    }

    if (body?.action === "revise_week") {
      const planId = String(body.plan_id || "");
      const note = String(body.note || "").trim();
      if (!planId || !note) return json({ error: "plan_id and note are required." }, 400);
      const { data: found } = await admin.from("calendar_plans").select("id, client_id").eq("id", planId).maybeSingle();
      if (!found) return json({ error: "No such plan." }, 404);
      const viaSecret = !!req.headers.get("x-socialytics-secret");
      const userId = await requireMember(req, found.client_id);
      // Writing the posts that have no copy yet is the cutover's job, not a button.
      const scope = viaSecret && body.scope === "empty" ? "empty" : "untouched";
      const { data: plan, error } = await admin.rpc("calendar_request_revision", { p_plan: planId, p_note: note, p_user: viaSecret ? null : userId, p_scope: scope });
      if (error) return json({ error: error.message }, 409);
      return json({ plan }, 202);
    }

    if (body?.action === "save_copy") {
      const clientId = String(body.client_id || "");
      const key = String(body.calendar_post_key || "");
      const copy = String(body.post_copy || "").trim();
      if (!clientId || !key || !copy) return json({ error: "client_id, calendar_post_key and post_copy are required." }, 400);
      const userId = await requireMember(req, clientId);
      const hashtags = Array.isArray(body.hashtags) ? body.hashtags.map(String).slice(0, 30) : null;
      const { data: before } = await admin.from("calendar_posts").select("copy, platform").eq("client_id", clientId).eq("post_key", key).maybeSingle();
      const { error } = await admin.from("post_iterations").insert({
        client_id: clientId, report_id: body.report_id || null, calendar_post_key: key,
        version: Number(body.version) || 1, platform: body.platform || null, post_copy: copy,
        hashtags, cta: body.cta || null, concept: body.concept || null, visual_direction: body.visual_direction || null,
        format: body.format || null, source: body.source === "regeneration" ? "regeneration" : "calendar", created_by: userId,
      });
      if (error) throw new Error(`Could not save the copy: ${error.message}`);
      // The calendar post holds the current copy too, for every view that reads it directly.
      await admin.from("calendar_posts").update({ copy, touched_at: new Date().toISOString(), ...(hashtags ? { hashtags } : {}), ...(body.cta ? { cta: String(body.cta) } : {}) })
        .eq("client_id", clientId).eq("post_key", key);
      // A person's edit says how they want copy written; a regeneration doesn't.
      const previous = String(before?.copy || "").trim();
      if (body.source !== "regeneration" && previous && previous !== copy) {
        background(learnFromSignal(admin, clientId, { kind: "copy_edit", before: previous, after: copy, platform: before?.platform ?? body.platform ?? null }), "memory");
      }
      return json({ ok: true });
    }

    if (body?.action === "preview_evidence") {
      const clientId = String(body.client_id || "");
      if (!clientId) return json({ error: "client_id is required." }, 400);
      await requireStaff(req, { writeClientId: clientId });
      const { data: client } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
      if (!client) return json({ error: "No such client." }, 404);
      const g = await gatherEvidence(admin, client, new Date());
      return json({ own_posts: g.own.length, rhythm: g.rhythm, learned_rhythm: g.learnedRhythm, evidence: g.evidence, avoid: g.avoid, thin: g.thin, sources: g.sources, examples: g.examples });
    }

    if (body?.action === "consolidate_memory") {
      const clientId = String(body.client_id || "");
      if (!clientId) return json({ error: "client_id is required." }, 400);
      await requireStaff(req, { writeClientId: clientId });
      return json(await consolidateMemory(admin, clientId));
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
