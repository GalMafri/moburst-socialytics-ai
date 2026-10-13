// Rewrites one suggested test on a competitive report from the team's
// feedback (Lital, 13 Oct: "implement feedback and edit the suggested tests,
// not just thumbs up and down").
//
//   POST { report_id, original_gap, current: {gap, why_it_matters, suggested_play}, feedback }
//   -> { revision: {gap, why_it_matters, suggested_play} }
//   POST { action: "learn", report_id, original: {...}, edited: {...}, feedback? }
//   -> { learned: [{kind, text}] }   one or two standing preferences for the
//      client, saved to competitive_learnings, from what the edit changed.
//
// Staff with write access to the report's client only. Nothing is saved here:
// the page shows the rewrite in the edit dialog, and the person saves it (the
// edit lives on competitive_insight_feedback, keyed by the original text).
// The rewrite is written from the report's own figures, never invented ones.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { normalizedCompetitiveMetrics } from "../_shared/competitive/reportMetrics.ts";
import { withCompetitiveEvidenceLimits } from "../_shared/competitive/reportEvidence.ts";
import { type CompetitiveLearning, learningLines, parseLearnings, parseRevision, SUGGESTION_LIMITS } from "../_shared/competitive/suggestionEdits.ts";

const MODEL = "claude-opus-5-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const round = (n: unknown, digits = 1) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10 ** digits) / 10 ** digits : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const reportId = text(body?.report_id, 64);
    const feedback = text(body?.feedback, 1200);
    if (!reportId) return json({ error: "Which report is this suggestion on?" }, 400);
    if (!feedback && body?.action !== "learn") return json({ error: "Write what should change, then rewrite." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: report } = await admin.from("competitive_reports").select("id, client_id, report_data, status").eq("id", reportId).maybeSingle();
    if (!report || report.status !== "complete") return json({ error: "That report is not available." }, 404);
    const caller = await requireStaff(req, { writeClientId: report.client_id });
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "Rewriting is not set up yet." }, 503);
    const { data: known } = await admin.from("competitive_learnings").select("kind, text").eq("client_id", report.client_id).order("created_at", { ascending: false }).limit(20);
    const learnings = (known || []) as CompetitiveLearning[];

    if (body?.action === "learn") {
      return json({ learned: await learn(admin, apiKey, report.client_id, body, feedback, learnings, caller.userId) });
    }

    const { data: client } = await admin.from("clients").select("name, brand_identity").eq("id", report.client_id).maybeSingle();
    const brand = client?.name ?? "the client";
    // deno-lint-ignore no-explicit-any
    const rd: any = withCompetitiveEvidenceLimits(normalizedCompetitiveMetrics(report.report_data || {}));
    const ai = rd.ai_analysis || {};
    // deno-lint-ignore no-explicit-any
    const companies: any[] = rd.aggregates?.companies || [];
    const current = {
      gap: text(body?.current?.gap, 400),
      why_it_matters: text(body?.current?.why_it_matters, 1200),
      suggested_play: text(body?.current?.suggested_play, 1200),
    };
    if (!current.gap) return json({ error: "The suggestion to rewrite is missing." }, 400);
    const originalGap = text(body?.original_gap, 400) || current.gap;
    // deno-lint-ignore no-explicit-any
    const others = (Array.isArray(ai.gaps_for_client) ? ai.gaps_for_client : []).map((g: any) => text(g?.gap, 200)).filter((g: string) => g && g !== originalGap);

    const facts = companies.map((c) => ({
      company: c.name,
      role: c.is_client ? "client" : "competitor",
      tracked_posts: c.post_count ?? null,
      posts_per_week: round(c.cadence_per_week),
      engagement_rate_pct: c.engagement_rate_avg == null ? null : round(c.engagement_rate_avg * 100, 2),
      engagements_per_post: round(c.engagement_avg),
      channels: (c.channel_mix || []).map((m: { key: string; count: number }) => `${m.key} ${m.count}`).join(", "),
      formats: (c.media_type_mix || []).map((m: { key: string; count: number }) => `${m.key} ${m.count}`).join(", "),
      top_hashtags: (c.top_hashtags || []).slice(0, 5).map((h: { key: string }) => h.key),
    }));
    const prompt = [
      `You are revising one suggested test in a competitive social media report for ${brand}${rd.period?.start ? `, covering ${rd.period.start} to ${rd.period.end}` : ""}.`,
      client?.brand_identity?.tone_of_voice ? `${brand}'s voice: ${text(client.brand_identity.tone_of_voice, 400)}` : "",
      `What the report measured, per company:\n${JSON.stringify(facts, null, 1)}`,
      ai.executive_summary ? `The report's summary: ${text(ai.executive_summary, 1500)}` : "",
      // deno-lint-ignore no-explicit-any
      Array.isArray(ai.winner_teardown) && ai.winner_teardown.length ? `What works for competitors:\n${ai.winner_teardown.slice(0, 4).map((w: any) => `- ${text(w.competitor, 80)}: ${text(w.pattern, 300)}`).join("\n")}` : "",
      others.length ? `The report's other suggestions (do not duplicate them):\n${others.map((o: string) => `- ${o}`).join("\n")}` : "",
      learnings.length ? `The team's standing preferences for ${brand}'s suggestions (follow every one):\n${learningLines(learnings).map((l) => `- ${l}`).join("\n")}` : "",
      `The suggestion as it stands:\n${JSON.stringify(current, null, 1)}`,
      `The account team's feedback on it:\n${feedback}`,
      [
        "Rewrite this one suggestion so it does what the feedback asks.",
        "- Keep it a test the team can run next month: what to post, where, how often, and what result to look for.",
        "- Use only figures that appear above. Never invent numbers, names or results. A target is a goal to test, said as a goal.",
        "- Name competitors where it helps. Never name data tools or vendors.",
        "- Plain American English, short sentences, no dashes as punctuation.",
        `- gap: one sentence, at most ${SUGGESTION_LIMITS.gap - 20} characters. why_it_matters: at most three sentences. suggested_play: at most three sentences.`,
        'Reply with JSON only: {"gap":"...","why_it_matters":"...","suggested_play":"..."}',
      ].join("\n"),
    ].filter(Boolean).join("\n\n");

    let revision = null;
    for (let attempt = 0; attempt < 2 && !revision; attempt++) {
      const result = await anthropicMessages({ apiKey, body: { model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] } });
      revision = parseRevision(result.text);
    }
    if (!revision) return json({ error: "The rewrite did not come back usable. Try again, or edit it by hand." }, 502);
    return json({ revision });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    console.error("[revise-suggestion]", err instanceof Error ? err.message : err);
    return json({ error: "The rewrite failed. Try again, or edit it by hand." }, 500);
  }
});

/**
 * What an edit teaches about this client's suggestions: one or two standing
 * preferences, general enough to apply to the next run's suggestions, saved
 * to competitive_learnings. Preferences the client already has are not added
 * again (unique on the lower-cased text).
 */
// deno-lint-ignore no-explicit-any
async function learn(admin: any, apiKey: string, clientId: string, body: any, feedback: string, known: CompetitiveLearning[], userId: string | null): Promise<CompetitiveLearning[]> {
  const side = (x: unknown) => ({
    gap: text((x as Record<string, unknown>)?.gap, 400),
    why_it_matters: text((x as Record<string, unknown>)?.why_it_matters, 1200),
    suggested_play: text((x as Record<string, unknown>)?.suggested_play, 1200),
  });
  const before = side(body?.original), after = side(body?.edited);
  if (!before.gap || !after.gap) return [];
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const prompt = [
    "An account team edited a suggested test in a competitive social media report for their client.",
    `The suggestion before:\n${JSON.stringify(before, null, 1)}`,
    `After the team's edit:\n${JSON.stringify(after, null, 1)}`,
    feedback ? `The feedback they gave:\n${feedback}` : "",
    known.length ? `Preferences already recorded for this client (do not repeat them):\n${learningLines(known).map((l) => `- ${l}`).join("\n")}` : "",
    "What does this edit say about how this client's suggested tests should be written from now on? Write one or two preferences.",
    "Each is one sentence of at most 140 characters, concrete enough to act on, and general enough to apply to future suggestions (never about this one suggestion's specific numbers or wording).",
    "If the edit only fixed wording and teaches nothing lasting, return no rules.",
    'Reply with JSON only: {"rules":[{"kind":"prefer"|"avoid","text":"..."}]}',
  ].filter(Boolean).join("\n\n");
  const result = await anthropicMessages({ apiKey, body: { model: MODEL, max_tokens: 600, messages: [{ role: "user", content: prompt }] } });
  const rules = parseLearnings(result.text).filter((r) => !known.some((k) => k.text.toLowerCase() === r.text.toLowerCase()));
  const saved: CompetitiveLearning[] = [];
  for (const r of rules) {
    const { error } = await admin.from("competitive_learnings").insert({
      client_id: clientId, kind: r.kind, text: r.text,
      source_insight_key: text(body?.insight_key, 200) || null, source_feedback: feedback || null, created_by: userId,
    });
    if (!error) saved.push(r);
  }
  return saved;
}
