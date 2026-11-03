// supabase/functions/calendar-posts/index.ts
//
// The content calendar's actions (weekly calendar, Lital 19 Oct 2026). Plans
// are made once per week by the scheduled jobs (_shared/calendar/runWeek.ts):
// every Monday for the following week, or when someone asks here.
//
//   POST {action:"plan_next_week", client_id}
//        a member of the client or staff: plan the earliest week without a
//        plan (or whose plan a person stopped or removed), from this week up
//        to four weeks ahead
//   POST {action:"stop_plan", plan_id}
//        a member of the client or staff: stop a plan that is queued or being
//        written, or remove a finished one while its week has days to come.
//        The posts nobody worked on leave the calendar; the rest stay
//        (calendar_stop_plan decides; Lital, 3 Nov 2026)
//   POST {action:"revise_week", plan_id, note}
//        a member of the client or staff: rewrite the week's posts nobody
//        worked on, following the note (the note also teaches the memory)
//   POST {action:"save_copy", client_id, calendar_post_key, post_copy, source?, note?, ...}
//        a member of the client or staff: save a copy edit (a revision row
//        without media) and update the calendar post; a person's edit
//        teaches the client's preference memory, and a regeneration teaches
//        only through the note left on it, answering what it learned (copy.ts)
//   POST {action:"undo_note", client_id, changes}
//        a member of the client or staff: take back what a note taught
//   POST {action:"preview_evidence", client_id, week?}
//        staff with write access: what the planner would see for this client
//        now (rhythm and where it came from, scored evidence, thin data), with
//        no model call
//
// Reasons are worded when shown (_shared/calendar/reasonText.ts) and the
// monthly voice job keeps the preference memory short, so neither needs an
// action here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { requireMember } from "../_shared/auth/requireMember.ts";
import { learnFromSignal, undoLearning } from "../_shared/voice/load.ts";
import { CLIENT_COLUMNS, gatherEvidence } from "../_shared/calendar/runWeek.ts";
import { plannable } from "../_shared/calendar/planState.ts";
import { type CopyDeps, saveCopy, undoNote } from "./copy.ts";

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
      const week = weeks.find((w) => plannable(held.get(w)));
      if (!week) return json({ error: "The next four weeks are already planned." }, 409);
      const { data: plan, error } = await admin.rpc("calendar_request_week", { p_client: clientId, p_week: week, p_trigger: "button", p_user: userId });
      if (error) return json({ error: error.message }, 409);
      return json({ plan, week }, 202);
    }

    if (body?.action === "stop_plan") {
      const planId = String(body.plan_id || "");
      if (!planId) return json({ error: "plan_id is required." }, 400);
      const { data: found } = await admin.from("calendar_plans").select("id, client_id").eq("id", planId).maybeSingle();
      if (!found) return json({ error: "No such plan." }, 404);
      const userId = await requireMember(req, found.client_id);
      const { data: plan, error } = await admin.rpc("calendar_stop_plan", { p_plan: planId, p_user: userId });
      if (error) return json({ error: error.message }, 409);
      return json({ plan });
    }

    if (body?.action === "revise_week") {
      const planId = String(body.plan_id || "");
      const note = String(body.note || "").trim();
      if (!planId || !note) return json({ error: "plan_id and note are required." }, 400);
      const { data: found } = await admin.from("calendar_plans").select("id, client_id").eq("id", planId).maybeSingle();
      if (!found) return json({ error: "No such plan." }, 404);
      const viaSecret = !!req.headers.get("x-socialytics-secret");
      const userId = await requireMember(req, found.client_id);
      // Writing the posts that have no copy yet is the daily run's job (enqueue_scheduled_report_jobs), not a button.
      const scope = viaSecret && body.scope === "empty" ? "empty" : "untouched";
      const { data: plan, error } = await admin.rpc("calendar_request_revision", { p_plan: planId, p_note: note, p_user: viaSecret ? null : userId, p_scope: scope });
      if (error) return json({ error: error.message }, 409);
      return json({ plan }, 202);
    }

    if (body?.action === "save_copy" || body?.action === "undo_note") {
      const deps = copyDeps(admin, req);
      const answer = body.action === "save_copy" ? await saveCopy(deps, body) : await undoNote(deps, body);
      return json(answer.body, answer.status ?? 200);
    }

    if (body?.action === "preview_evidence") {
      const clientId = String(body.client_id || "");
      if (!clientId) return json({ error: "client_id is required." }, 400);
      await requireStaff(req, { writeClientId: clientId });
      const { data: client } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
      if (!client) return json({ error: "No such client." }, 404);
      // The week to preview (its Monday); by default the week after this one.
      const week = /^\d{4}-\d{2}-\d{2}$/.test(String(body.week || "")) ? mondayOf(String(body.week)) : undefined;
      const g = await gatherEvidence(admin, client, new Date(), { week });
      return json({ own_posts: g.own.length, rhythm: g.rhythm, learned_rhythm: g.learnedRhythm, rhythm_sources: g.rhythmSources, evidence: g.evidence, avoid: g.avoid, thin: g.thin, sources: g.sources, examples: g.examples });
    }

    return json({ error: `Unknown action '${body?.action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendar-posts]", msg);
    return json({ error: msg }, 500);
  }
});

/** What the copy actions (copy.ts) need from this function. */
function copyDeps(admin: ReturnType<typeof service>, req: Request): CopyDeps {
  return {
    db: admin,
    requireMember: (clientId) => requireMember(req, clientId),
    learn: (clientId, signal) => learnFromSignal(admin, clientId, signal),
    undo: (clientId, changes) => undoLearning(admin, clientId, changes),
    background,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
