// supabase/functions/_shared/calendar/planner.ts
//
// Planning calendar weeks from a monthly report (the plan of 12 Oct, applied
// 13 Oct): every post is written from what the report found (performance,
// trends, competitors) or for a dated moment in the client's market, and says
// which. Each busy platform keeps one trend slot a week, written shortly
// before its date from what is trending then. Free of Deno and network
// imports so it can be tested.

export interface PlanContext {
  brand: string;
  voice: string | null;
  pillars: Array<{ name: string; description?: string }>;
  market: string[];
  languages: string[];
  findings: { performance: string[]; trends: string[]; competitors: string[] };
  /** The brand's posting pattern: one week of its plan, by weekday. */
  pattern: Array<{ weekday: string; platform: string; format: string | null; posting_time: string | null }>;
  /** Posts already planned around this week, so topics are not repeated. */
  nearby: Array<{ date: string; platform: string; copy: string }>;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekDates(monday: string): string[] {
  const base = new Date(`${monday}T00:00:00Z`).getTime();
  return WEEKDAYS.map((_, i) => iso(new Date(base + i * 86400000)));
}

export function weekPrompt(c: PlanContext, monday: string): string {
  const dates = weekDates(monday);
  const list = (title: string, xs: string[]) => (xs.length ? [title, ...xs.slice(0, 8).map((x) => `- ${x}`)].join("\n") : "");
  return [
    `You plan social media posts for ${c.brand}.`,
    c.voice ? `${c.brand}'s voice: ${c.voice}` : "",
    c.pillars.length ? ["Content pillars:", ...c.pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`)].join("\n") : "",
    c.market.length ? `Market: ${c.market.join(", ")}.` : "",
    c.languages.length ? `Write in: ${c.languages.join(", ")}.` : "",
    "What the latest monthly report found:",
    list("Performance:", c.findings.performance),
    list("Trends:", c.findings.trends),
    list("Competitors:", c.findings.competitors),
    ["The brand's posting pattern for a week (keep the same days, platforms, formats and times):", ...c.pattern.map((p) => `- ${p.weekday}: ${p.platform}${p.format ? ` ${p.format}` : ""}${p.posting_time ? ` at ${p.posting_time}` : ""}`)].join("\n"),
    c.nearby.length ? ["Posts already planned around this week (do not repeat their topics or openings):", ...c.nearby.slice(0, 30).map((n) => `- ${n.date} ${n.platform}: ${n.copy.split("\n")[0].slice(0, 120)}`)].join("\n") : "",
    `Plan the week of ${monday} (Monday) to ${dates[6]} (Sunday), following the posting pattern.`,
    "For each post give:",
    "- date (YYYY-MM-DD), platform, format, posting_time, and pillar (one of the content pillars)",
    `- copy: the full caption, in ${c.brand}'s voice, ready to publish`,
    "- hashtags (a list), cta, and visual_direction (one sentence on what the visual shows)",
    "- reason: {\"type\": \"performance\" | \"trend\" | \"competitor\" | \"seasonal\", \"label\": the specific finding or dated moment this post acts on, in one short sentence}",
    "Every post acts on one specific finding above, or on a dated moment.",
    `Dated moments: if a holiday, awareness day or industry event that matters in ${c.market.length ? c.market.join(", ") : "the brand's market"} falls in this week, plan the post nearest it for that moment, on its date, with reason type "seasonal".`,
    "Trend slots: for each platform with two or more posts in the week, make one of them a trend slot instead, with only date, platform, format, posting_time and \"trend_slot\": true. It is written shortly before its date from what is trending then.",
    'Reply with JSON only: {"posts":[{"date":"...","platform":"...","format":"...","posting_time":"...","pillar":"...","copy":"...","hashtags":["..."],"cta":"...","visual_direction":"...","reason":{"type":"performance","label":"..."}}]}',
  ].filter(Boolean).join("\n\n");
}

export interface PlannedPost {
  post_date: string;
  platform: string;
  format: string | null;
  posting_time: string | null;
  pillar: string | null;
  copy: string;
  hashtags: string[];
  cta: string | null;
  visual_direction: string | null;
  reasons: Array<{ type: string; label: string; report_id?: string }>;
  source: "report" | "trend_slot";
}

const REASON_TYPES = new Set(["performance", "trend", "competitor", "seasonal"]);

/** The week's posts from the planner's reply; posts outside the week or without copy (other than trend slots) are dropped. */
export function parseWeek(text: string, monday: string, reportId: string | null): PlannedPost[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const raw = (data as { posts?: unknown })?.posts;
  if (!Array.isArray(raw)) return [];
  const dates = new Set(weekDates(monday));
  const out: PlannedPost[] = [];
  for (const p of raw as Array<Record<string, unknown>>) {
    const date = String(p?.date ?? "");
    const platform = String(p?.platform ?? "").trim();
    if (!dates.has(date) || !platform) continue;
    const slot = p.trend_slot === true;
    const copy = String(p.copy ?? "").trim();
    if (!slot && !copy) continue;
    const reason = p.reason as { type?: unknown; label?: unknown } | undefined;
    const type = REASON_TYPES.has(String(reason?.type)) ? String(reason?.type) : "performance";
    const label = String(reason?.label ?? "").trim();
    out.push({
      post_date: date,
      platform,
      format: p.format ? String(p.format) : null,
      posting_time: p.posting_time ? String(p.posting_time) : null,
      pillar: !slot && p.pillar ? String(p.pillar) : null,
      copy: slot ? "" : copy,
      hashtags: !slot && Array.isArray(p.hashtags) ? (p.hashtags as unknown[]).map(String).slice(0, 12) : [],
      cta: !slot && p.cta ? String(p.cta) : null,
      visual_direction: !slot && p.visual_direction ? String(p.visual_direction) : null,
      reasons: slot
        ? [{ type: "trend", label: "Written shortly before its date from what is trending then" }]
        : [{ type, label: label || "Planned from the monthly report", ...(reportId ? { report_id: reportId } : {}) }],
      source: slot ? "trend_slot" : "report",
    });
  }
  return out;
}

/** The instruction for writing a trend slot from what is trending now. */
export function trendSlotPrompt(c: { brand: string; voice: string | null; languages: string[]; platform: string; format: string | null; date: string; trends: string[]; nearby: Array<{ date: string; platform: string; copy: string }>; taken?: string[] }): string {
  return [
    `Write one ${c.platform}${c.format ? ` ${c.format}` : ""} post for ${c.brand}, to go out on ${c.date}.`,
    c.voice ? `${c.brand}'s voice: ${c.voice}` : "",
    c.languages.length ? `Write in: ${c.languages.join(", ")}.` : "",
    ["What is trending now for this brand's audience and category:", ...c.trends.slice(0, 12).map((t) => `- ${t}`)].join("\n"),
    c.nearby.length ? ["Posts planned around that date (do not repeat their topics):", ...c.nearby.slice(0, 20).map((n) => `- ${n.date} ${n.platform}: ${n.copy.split("\n")[0].slice(0, 120)}`)].join("\n") : "",
    c.taken?.length ? ["Trends other posts around that date already act on (choose a different one):", ...c.taken.map((t) => `- ${t}`)].join("\n") : "",
    `Pick the one trend that suits this brand best and is not already taken, and write the post on it as a ${c.platform}${c.format ? ` ${c.format}` : ""}.`,
    'Reply with JSON only: {"copy":"the full caption","hashtags":["..."],"cta":"...","visual_direction":"one sentence","trend":"the trend it acts on, in one short sentence"}',
  ].filter(Boolean).join("\n\n");
}
