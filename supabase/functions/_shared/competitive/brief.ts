// The competitive picture as a prompt block, for any generation step that
// writes content for a client (ad-hoc posts, copy rewrites). Uses the latest
// complete competitive report and the team's verdicts on its gaps: endorsed
// gaps must be addressed, hidden gaps must not be proposed, everything else is
// context. Returns "" when the client has no competitive analysis yet.

// deno-lint-ignore no-explicit-any
type AnyClient = any;

const insightKey = (text: string) =>
  String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "untitled";

export async function competitiveBrief(supabase: AnyClient, clientId: string, platform?: string | null): Promise<string> {
  const { data: report } = await supabase
    .from("competitive_reports")
    .select("created_at, report_data")
    .eq("client_id", clientId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!report) return "";
  const { data: feedback } = await supabase
    .from("competitive_insight_feedback")
    .select("insight_key, verdict, gap_text")
    .eq("client_id", clientId);
  const verdict = new Map<string, string>((feedback || []).map((f: any) => [f.insight_key, f.verdict]));

  const rd: any = report.report_data || {};
  const ai = rd.ai_analysis || {};
  const plat = String(platform || "").toLowerCase();
  const gaps: any[] = Array.isArray(ai.gaps_for_client) ? ai.gaps_for_client : [];
  const relevant = gaps.filter((g) => !plat || !g.platform || g.platform === "all" || String(g.platform).toLowerCase().includes(plat.slice(0, 4)));
  const endorsed = relevant.filter((g) => verdict.get(insightKey(g.gap)) === "up");
  const open = relevant.filter((g) => !verdict.has(insightKey(g.gap)));
  const suppressed = (feedback || []).filter((f: any) => f.verdict === "down").map((f: any) => f.gap_text).filter(Boolean);
  const winners: any[] = Array.isArray(ai.winner_teardown) ? ai.winner_teardown : [];
  const schedule = ai.recommended_schedule;

  const lines: string[] = [];
  lines.push(`COMPETITIVE PICTURE (analysis from ${String(report.created_at).slice(0, 10)}${rd.landscape?.name ? `, landscape "${rd.landscape.name}"` : ""}):`);
  if (ai.executive_summary) lines.push(`Summary: ${String(ai.executive_summary).slice(0, 600)}`);
  if (endorsed.length) {
    lines.push("Gaps the account team has decided to act on (address at least one of these directly):");
    for (const g of endorsed.slice(0, 5)) lines.push(`- [${g.platform || "all"}] ${g.gap}. Play: ${g.suggested_play || "n/a"}`);
  }
  if (open.length) {
    lines.push("Other gaps versus competitors (use when relevant):");
    for (const g of open.slice(0, 4)) lines.push(`- [${g.platform || "all"}] ${g.gap}`);
  }
  if (winners.length) {
    lines.push("What wins for competitors (borrow the mechanics, never the brand):");
    for (const w of winners.slice(0, 3)) lines.push(`- ${w.competitor}: ${w.pattern}`);
  }
  if (schedule?.rationale) lines.push(`Recommended posting rhythm: ${String(schedule.rationale).slice(0, 300)}`);
  if (suppressed.length) {
    lines.push("Do NOT propose these ideas; the team rejected them:");
    for (const s of suppressed.slice(0, 8)) lines.push(`- ${s}`);
  }
  return lines.join("\n");
}
