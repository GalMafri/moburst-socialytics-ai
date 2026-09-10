// Renders one competitive_reports row (project step 11's in-app half).
//
// Open to client members for status='complete' rows via RLS, exactly like the
// social report view: the router does not guard this route, the policies do.
// The data shape is produced by the n8n workflow's Assemble Report Data node.
// One platform filter drives the field, the rhythm strips, the gaps and the
// top posts. Reports run before per-platform aggregation existed have no
// by_channel data, so the filter only appears when it can do something.

import { useMemo, useRef, useState } from "react";
import { RetryReportButton } from "@/components/reports/RetryReportButton";
import { StatCard } from "@/components/ui/stat-card";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { displayCompanyName, nameifyDomains } from "@/lib/companyName";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { PostVisual, usePostPreviews, normalizePlatform, platformLabel } from "@/components/competitive/PostVisual";
import { PlatformIcon } from "@/lib/platform-config";
import { partitionGaps, useInsightFeedback } from "@/hooks/useInsightFeedback";
import { formatRange } from "@/lib/dateRange";
import { ReportActions } from "@/components/reports/ReportActions";
import { ExportPdfButton } from "@/components/reports/ExportPdfButton";
import { Prose } from "@/components/ui/prose";
import { Section, SectionNav } from "@/components/ui/section";
import { RankedBars, compactNumber } from "@/components/ui/bars";
import { ChangeCards } from "@/components/competitive/ChangeCards";
import { companiesFromReport, diffCompanies, pickComparableReport, reportPeriod as periodOf } from "@/lib/competitiveChanges";
import { ArrowLeft, Crosshair, ExternalLink, Gauge, Lightbulb, Clock, Trophy, Hash, Layers, ThumbsUp, ThumbsDown, History, CalendarCheck, Eye, RotateCcw, Rss, Images, Users } from "lucide-react";

type TopPost = {
  engagement: number; engagement_rate: number; est_impressions?: number; reach?: number; views: number;
  applause?: number; conversation?: number; amplification?: number;
  text: string; url: string | null; image?: string | null; created: string | null; media_type: string; channel: string;
  /** RivalIQ's paid-promotion signal, Facebook posts only. */
  likely_boosted?: boolean;
};
/** A RivalIQ period total with the previous equal-length period beside it. */
type Both = { current: number; previous: number | null };
type RivalIQMetrics = {
  period?: { start: string; end: string };
  previous_period?: { start: string; end: string } | null;
  audience?: Both; engagement?: Both; estimated_impressions?: Both; posts?: Both; engagement_rate_per_post?: Both; likely_boosted_facebook_posts?: Both;
  by_network?: Record<string, { followers?: Both; posts?: Both; engagement?: Both; impressions?: Both; views?: Both; rate?: Both; likely_boosted?: Both }>;
  daily?: Array<{ date: string; posts: number; engagement: number; audience: number }>;
};
type Bucket = {
  post_count: number; cadence_per_week: number; engagement_avg: number; engagement_rate_avg: number; impressions_avg?: number;
  views_total: number; impressions_total: number; reach_total?: number;
  by_weekday: Record<string, number>; by_hour: Record<string, number>;
  top_hashtags: Array<{ key: string; count: number }>; media_type_mix: Array<{ key: string; count: number }>;
  top_posts: TopPost[];
};
type Company = Bucket & {
  company_id: string; name: string; url: string | null; is_client: boolean; in_confirmed_top3: boolean;
  channel_mix: Array<{ key: string; count: number }>; by_channel?: Record<string, Bucket>;
  rivaliq_metrics?: RivalIQMetrics | null;
};

const EMPTY: Bucket = { post_count: 0, cadence_per_week: 0, engagement_avg: 0, engagement_rate_avg: 0, impressions_avg: 0, views_total: 0, impressions_total: 0, by_weekday: {}, by_hour: {}, top_hashtags: [], media_type_mix: [], top_posts: [] };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i));
const ACCENT = "185,224,69";
const RECOMMEND = "120,190,255";

/**
 * The busiest key in a set of counts, with its share of the total.
 *
 * The analysis writes this out in prose — "extremely concentrated at 18:00
 * UTC: 30/54 posts (56%)" — for a grid the page is already drawing. Reading it
 * off the same counts puts the number where the grid is, and it stays true
 * when the platform filter changes, which a sentence written once does not.
 */
function peakOf(counts: Record<string, number> | undefined): { key: string; count: number; share: number } | null {
  const entries = Object.entries(counts || {}).filter(([, n]) => Number(n) > 0);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, n]) => s + Number(n), 0);
  const [key, count] = entries.reduce((best, e) => (Number(e[1]) > Number(best[1]) ? e : best));
  return { key, count: Number(count), share: total ? Number(count) / total : 0 };
}

const fmt = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? "–" : `${(n * 100).toFixed(2)}%`);

function bucketFor(c: Company, plat: string): Bucket {
  if (plat === "all") return c;
  const entry = Object.entries(c.by_channel || {}).find(([k]) => normalizePlatform(k) === plat);
  return entry ? entry[1] : EMPTY;
}

/**
 * Heat cells for a set of buckets (weekdays, hours). The track is a grid capped
 * at `cell` px rather than a row of fixed-width boxes, so a 24-hour strip shrinks
 * to fit its card instead of running past the edge and being clipped by the glass
 * surface on laptop widths.
 */
function HeatStrip({ counts, keys, labelEvery = 1, cell = 24, color = ACCENT }: { counts: Record<string, number>; keys: string[]; labelEvery?: number; cell?: number; color?: string }) {
  const max = Math.max(1, ...keys.map((k) => Number(counts?.[k]) || 0));
  return (
    <div className="grid gap-[3px] w-full min-w-0" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, ${cell}px))` }}>
      {keys.map((k, i) => {
        const v = Number(counts?.[k]) || 0;
        return (
          <div key={k} className="flex flex-col items-center gap-1 min-w-0" title={`${k}: ${v} post${v === 1 ? "" : "s"}`}>
            <div className="h-6 w-full rounded-[6px]" style={{ backgroundColor: `rgba(${color},${v ? 0.18 + 0.82 * (v / max) : 0.06})` }} />
            {i % labelEvery === 0 && <span className="t-secondary leading-none">{k}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return <StatCard label={label} value={value} sub={sub} accent={accent} />;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[rgba(255,255,255,0.06)] t-body">{children}</span>;
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-[9px] t-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(185,224,69,0.45)] ${active ? "bg-[rgba(255,255,255,0.12)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="t-body font-semibold leading-tight">{value}</p>
      <p className="t-subhead leading-tight">{label}</p>
    </div>
  );
}

/** One figure in a company tile. `exact` goes in the tooltip when the shown value is rounded. */
function TileStat({ value, label, exact }: { value: string; label: string; exact?: string }) {
  return (
    <div className="min-w-0">
      <p className="t-h1 tabular-nums truncate" title={exact && exact !== value ? exact : undefined}>{value}</p>
      <p className="t-secondary">{label}</p>
    </div>
  );
}

/** A labelled note in a company tile: the label over the passage, not inside it. */
function TileNote({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0">
      <dt className="t-subhead">{label}</dt>
      <dd className="t-body mt-0.5">{text}</dd>
    </div>
  );
}

const deltaPct = (v: Both | null | undefined): number | null => (v && v.previous != null && v.previous > 0 ? ((v.current - v.previous) / v.previous) * 100 : null);
const fmtDelta = (pctChange: number) => `${pctChange > 0 ? "+" : pctChange < 0 ? "-" : ""}${Math.abs(pctChange) >= 100 ? Math.round(Math.abs(pctChange)) : Math.abs(pctChange).toFixed(1).replace(/\.0$/, "")}%`;

/**
 * A period total with its change against the previous period.
 *
 * Only the client's own rows carry a sign colour. A competitor's engagement
 * halving is not bad news for the client, so colouring it red would read the
 * wrong way round; competitor movement stays neutral, as it does on the change
 * cards. A change that rounds to zero wears no colour either.
 */
function MetricRow({ label, value, format = compactNumber, signed = false }: { label: string; value: Both | null | undefined; format?: (v: number) => string; signed?: boolean }) {
  if (!value) return <Stat label={label} value="–" />;
  const change = deltaPct(value);
  const rounded = change == null ? null : Number(fmtDelta(change).replace(/[+%]/g, ""));
  const tone = !signed || !rounded ? "text-[#b1b7c1]" : change! > 0 ? "text-success" : "text-[#f87171]";
  return (
    <div className="min-w-0">
      <p className="t-body font-semibold leading-tight">
        {format(value.current)}
        {change != null && <span className={`t-label ml-1.5 ${tone}`}>{fmtDelta(change)}</span>}
      </p>
      <p className="t-subhead leading-tight">{label}</p>
    </div>
  );
}

export default function CompetitiveReportView() {
  const { id: clientId, reportId } = useParams();
  const navigate = useNavigate();
  const { isMoburstStaff } = useAuth();
  const { toast } = useToast();
  const [plat, setPlat] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const { rows: feedback, verdictFor, vote } = useInsightFeedback(clientId);

  const { data: report, isLoading } = useQuery({
    queryKey: ["competitive-report", reportId],
    queryFn: async () => {
      const { data, error } = await supabase.from("competitive_reports").select("*").eq("id", reportId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!reportId,
  });

  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("id", clientId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  // Change detection: the complete report on the same landscape covering the latest
  // period before this one is the baseline for "Since the last report".
  const { data: priorReports } = useQuery({
    queryKey: ["competitive-report-prior", clientId, report?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_reports")
        .select("id, created_at, date_range_start, date_range_end, report_data")
        .eq("client_id", clientId!)
        .eq("status", "complete")
        .neq("id", report!.id)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId && !!report?.id,
  });

  const rd: any = report?.report_data || {};
  const ai = rd.ai_analysis || {};
  const companies: Company[] = rd.aggregates?.companies || [];
  const previous = useMemo(() => (report ? pickComparableReport(report as any, (priorReports || []) as any[]) : null), [report, priorReports]);
  const changes = useMemo(() => (previous ? diffCompanies(companiesFromReport(previous.report_data), companiesFromReport(rd)) : []), [previous, rd]);
  // Chapter numerals follow the sections actually present: each band takes the next number in render order.

  // Every post the report carries, keyed by URL, for example-post lookups and previews.
  const allPosts = useMemo(() => {
    const map = new Map<string, TopPost & { company: string }>();
    for (const c of companies) {
      const lists = [c.top_posts || [], ...Object.values(c.by_channel || {}).map((b) => b.top_posts || [])];
      for (const list of lists) for (const p of list) if (p.url && !map.has(p.url)) map.set(p.url, { ...p, company: c.name });
    }
    return map;
  }, [companies]);
  // Every post goes through post-preview: posts without a creative get one
  // resolved, posts with an expiring CDN link get a durable copy.
  const previewItems = useMemo(() => Array.from(allPosts.values()).map((p) => ({ url: p.url, image: p.image || null, mediaType: p.media_type })), [allPosts]);
  const { previews } = usePostPreviews(previewItems);

  const platforms = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of companies) {
      for (const [k, b] of Object.entries(c.by_channel || {})) {
        const key = normalizePlatform(k);
        if (key) totals.set(key, (totals.get(key) || 0) + (b.post_count || 0));
      }
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [companies]);
  const hasChannels = platforms.length > 0;
  const effectivePlat = plat !== "all" && platforms.includes(plat) ? plat : "all";

  if (isLoading) return <AppLayout><Loading label="Loading report" /></AppLayout>;
  if (!report) {
    return (
      <AppLayout>
        <EmptyState icon={Crosshair} title="Report not available" description="It may still be running, or you may not have access to it." />
      </AppLayout>
    );
  }

  const me = companies.find((c) => c.is_client) || null;
  const rivals = companies.filter((c) => !c.is_client).sort((a, b) => b.post_count - a.post_count);
  const meB = me ? bucketFor(me, effectivePlat) : null;
  const rivalBuckets = rivals.map((c) => ({ c, b: bucketFor(c, effectivePlat) }));
  const activeRivals = rivalBuckets.filter((x) => x.b.post_count > 0);
  const avg = (f: (b: Bucket) => number) => (activeRivals.length ? activeRivals.reduce((s, x) => s + f(x.b), 0) / activeRivals.length : 0);
  const totalPosts = (meB?.post_count || 0) + rivalBuckets.reduce((s, x) => s + x.b.post_count, 0);
  const shareOfVoice = meB && totalPosts ? (meB.post_count / totalPosts) * 100 : null;
  const scorecard = ai.benchmark_scorecard;
  const period = rd.period?.start ? formatRange(rd.period) : report.date_range_start ? formatRange({ start: report.date_range_start, end: report.date_range_end }) : "";
  const clientName = client?.name || rd.aggregates?.client_name || "Client";
  const ordered = [...(me ? [me] : []), ...rivals];

  const gapsForPlatform = (ai.gaps_for_client || []).filter((g: any) => effectivePlat === "all" || !g.platform || g.platform === "all" || normalizePlatform(g.platform) === effectivePlat);
  const { visible: gaps, hidden: hiddenGaps } = partitionGaps<any>(gapsForPlatform, feedback);
  const schedule = ai.recommended_schedule;

  // RivalIQ's own period totals (runs from 2026-09-06 onward), for the whole
  // landscape or for the filtered network.
  const netKey = effectivePlat === "x" ? "twitter" : effectivePlat;
  const metricsFor = (c: Company) => {
    const m = c.rivaliq_metrics;
    if (!m) return null;
    if (effectivePlat === "all") return { audience: m.audience, engagement: m.engagement, impressions: m.estimated_impressions, posts: m.posts, boosted: m.likely_boosted_facebook_posts, by_network: m.by_network || {} };
    const n = m.by_network?.[netKey];
    if (!n) return null;
    return { audience: n.followers, engagement: n.engagement, impressions: n.impressions, posts: n.posts, boosted: n.likely_boosted, by_network: {} as NonNullable<RivalIQMetrics["by_network"]> };
  };
  const withMetrics = ordered.map((c) => ({ c, m: metricsFor(c) })).filter((x) => x.m) as { c: Company; m: NonNullable<ReturnType<typeof metricsFor>> }[];
  const hasMetrics = withMetrics.length > 0;
  const meM = me ? metricsFor(me) : null;
  const followersRows = withMetrics.filter((x) => x.m.audience && x.m.audience.current > 0).map((x) => ({ key: x.c.company_id, label: displayCompanyName(x.c.name), name: x.c.name, value: x.m.audience!.current, emphasized: x.c.is_client }));
  const previousDays = me?.rivaliq_metrics?.previous_period ? Math.round((Date.parse(me.rivaliq_metrics.previous_period.end) - Date.parse(me.rivaliq_metrics.previous_period.start)) / 86400000) + 1 : null;
  // RivalIQ answers "No Prediction" for most Facebook pages, and the signal does
  // not exist off Facebook at all, so only explain it when a company actually
  // has boosted posts to show.
  const anyBoosted = withMetrics.some((x) => (x.m.boosted?.current || 0) > 0);

  /**
   * The teardowns worth showing under the current filter.
   *
   * The pattern is written across platforms but the posts that prove it carry
   * a channel, so a filter keeps only the examples on that platform and drops
   * a teardown whose proof is all somewhere else. Reading a Facebook teardown
   * while the page says TikTok was the confusing part.
   */
  const teardowns = (Array.isArray(ai.winner_teardown) ? ai.winner_teardown : [])
    .map((w: any) => {
      const all: Array<{ url: string; post?: TopPost }> = (w.example_post_urls || []).slice(0, 6).map((u: string) => ({ url: u, post: allPosts.get(u) }));
      const examples = effectivePlat === "all" ? all.slice(0, 3) : all.filter((ex) => normalizePlatform(ex.post?.channel || "") === effectivePlat).slice(0, 3);
      return { ...w, examples };
    })
    .filter((w: any) => effectivePlat === "all" || w.examples.length > 0);

  /** The analysis's note for this company on the filtered platform, when it wrote one. */
  const platformNoteFor = (name: string) =>
    effectivePlat === "all"
      ? undefined
      : (breakdownFor(name)?.platform_notes || []).find((n: any) => normalizePlatform(n.platform) === effectivePlat)?.note;

  /**
   * Every section says what it is showing, once a filter is on.
   *
   * Marking only the four sections a filter cannot narrow still left the
   * reader working out the rest by elimination. Now each section carries its
   * own scope: the platform in the accent, or "All platforms" in grey for the
   * parts the analysis writes once for the whole account.
   */
  const scopeTag = (scoped: boolean) => {
    if (effectivePlat === "all") return undefined;
    return scoped ? (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 t-label !text-[#b9e045] bg-[rgba(185,224,69,0.12)] border border-[rgba(185,224,69,0.3)] whitespace-nowrap">
        <PlatformIcon platform={effectivePlat} className="h-3 w-3" /> {platformLabel(effectivePlat)} only
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 t-label bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] whitespace-nowrap">
        All platforms
      </span>
    );
  };
  const acrossAll = scopeTag(false);

  // Every creative a company ran in the period (all channels, or the filtered
  // one), for the mood board grids.
  const moodPosts = (c: Company): TopPost[] => {
    const seen = new Set<string>();
    const out: TopPost[] = [];
    const lists = [bucketFor(c, effectivePlat).top_posts || [], ...(effectivePlat === "all" ? Object.values(c.by_channel || {}).map((b) => b.top_posts || []) : [])];
    for (const list of lists) for (const p of list) { const k = p.url || p.text; if (!k || seen.has(k)) continue; seen.add(k); out.push(p); }
    return out.slice(0, 16);
  };

  /**
   * Which sections this report has, and the order they read in.
   *
   * With a platform selected the page splits in two: everything the filter
   * narrows comes first, then a divider, then the parts the analysis writes
   * once for the whole account. Mixing the two down one column is what made
   * the filter hard to trust, and a tag on each header was not enough on its
   * own. Numbering, the rail and the layout all read from this list, so they
   * cannot disagree.
   */
  const present: Record<string, boolean> = {
    summary: !!ai.executive_summary,
    changes: !!previous,
    scorecard: (scorecard?.dimensions?.length || 0) > 0,
    field: companies.length > 0,
    audience: hasMetrics,
    rhythm: ordered.some((c) => bucketFor(c, effectivePlat).post_count > 0),
    gaps: gaps.length > 0 || hiddenGaps.length > 0,
    wins: teardowns.length > 0 || (effectivePlat !== "all" && Array.isArray(ai.winner_teardown) && ai.winner_teardown.length > 0),
    moodboards: ordered.some((c) => moodPosts(c).length > 0),
    posts: ordered.some((c) => bucketFor(c, effectivePlat).top_posts?.length),
  };
  const SCOPED_IDS = ["field", "audience", "rhythm", "gaps", "wins", "moodboards", "posts"];
  const WIDE_IDS = ["summary", "changes", "scorecard"];
  const NATURAL_IDS = ["summary", "changes", "scorecard", "field", "audience", "rhythm", "gaps", "wins", "moodboards", "posts"];
  const displayIds = (effectivePlat === "all" ? NATURAL_IDS : [...SCOPED_IDS, ...WIDE_IDS]).filter((id) => present[id]);
  /** The section's number in the order it is read. */
  const num = (id: string) => displayIds.indexOf(id) + 1;
  /** Its place in the flex column, so a filter can reorder without moving the markup. */
  const orderOf = (id: string) => (displayIds.indexOf(id) + 1) * 10;
  const firstWideId = displayIds.find((id) => WIDE_IDS.includes(id));
  const showZoneBreak = effectivePlat !== "all" && !!firstWideId;


  const castVote = async (g: any, verdict: "up" | "down") => {
    try {
      await vote({ gapText: g.gap, platform: g.platform || null, verdict, reportId: report.id });
      if (verdict === "down" && verdictFor(g.gap) !== "down") {
        toast({ title: "Suggestion hidden", description: `It will not be proposed again for ${clientName}. Restore it from "hidden suggestions" if you change your mind.` });
      } else if (verdict === "up" && verdictFor(g.gap) !== "up") {
        toast({ title: "Marked to implement", description: "The next monthly report and its content calendar will address this gap." });
      }
    } catch (e: any) {
      toast({ title: "Could not save feedback", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const hasContent = (p: TopPost) => !!(p.url || p.text || p.image);
  const postCard = (p: TopPost, key: string) => (
    <div key={key} className="glass-inner p-4 space-y-2.5 h-full flex flex-col">
      <PostVisual url={p.url} image={p.image} preview={p.url ? previews[p.url] : null} mediaType={p.media_type} platform={p.channel} maxHeight="26rem" />
      <p className={`t-body line-clamp-2 min-h-[3rem] ${p.text ? "" : "text-[#b1b7c1]"}`}>{p.text || (normalizePlatform(p.channel) === "x" || normalizePlatform(p.channel) === "twitter" ? "X posts arrive from RivalIQ without a caption or link." : "No caption provided.")}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Stat label="Est. impr." value={p.est_impressions ? fmt(p.est_impressions) : "–"} />
        <Stat label="Engagements" value={fmt(p.engagement)} />
        <Stat label="Eng. rate" value={p.engagement_rate ? pct(p.engagement_rate) : "–"} />
        <Stat label={p.views ? "Views" : "Reach"} value={p.views ? fmt(p.views) : p.reach ? fmt(p.reach) : "–"} />
      </div>
      <div className="flex items-center justify-between gap-2 t-secondary mt-auto">
        {(p.applause || p.conversation || p.amplification) ? (
          <span title="Likes and reactions · comments · shares">{fmt(p.applause || 0)} likes · {fmt(p.conversation || 0)} comments · {fmt(p.amplification || 0)} shares</span>
        ) : <span />}
        <span className="flex items-center gap-2">
          {p.likely_boosted && <Badge variant="secondary" title="RivalIQ estimates this Facebook post was paid promotion">Likely boosted</Badge>}
          {p.created ? new Date(p.created).toLocaleDateString() : ""}
        </span>
      </div>
    </div>
  );

  /** The analysis's written notes for one company, matched by name. */
  const breakdownFor = (name: string) =>
    (ai.competitor_breakdowns || []).find((x: any) => (x.name || "").toLowerCase() === name.toLowerCase());

  /** The dimensions the analysis describes in words, one row each. */
  const breakdownRows = (
    [
      { label: "Copy", key: "copy_style" },
      { label: "Look", key: "design_look" },
      { label: "Mix", key: "content_type_mix" },
    ] as const
  )
    .map((row) => ({
      label: row.label,
      // Under a filter the platform note wins where the analysis wrote one;
      // otherwise the overall read stands, marked as such in the caption.
      valueFor: (name: string) =>
        (effectivePlat !== "all" && row.key === "content_type_mix"
          ? platformNoteFor(name)
          : undefined) ?? (breakdownFor(name)?.[row.key] as string | undefined),
    }))
    .filter((row) => ordered.some((c) => row.valueFor(c.name)));

  // The running order for the rail. It drops whatever this report does not
  // have, so every section can be listed unconditionally.
  const SECTION_LABELS: Record<string, string> = {
    summary: "Summary",
    changes: "Since last report",
    scorecard: "Scorecard",
    field: "The field",
    audience: "Audience",
    rhythm: "Posting rhythm",
    gaps: "Gaps",
    wins: "What wins",
    moodboards: "Mood boards",
    posts: "Top posts",
  };
  // Same order the page reads in, so the rail matches a filtered page too.
  const navItems = displayIds.map((id) => ({ id, label: SECTION_LABELS[id] }));

  return (
    <AppLayout nav={<SectionNav items={navItems} />}>
      <div ref={printRef} className="w-full flex flex-col gap-8">

        {/* The line where the filtered half of the report ends. Everything above
            it is the platform you picked; everything below is written once for
            the whole account and cannot be narrowed. */}
        {showZoneBreak && (
          <div
            className="flex items-center gap-4 pt-2"
            style={{ order: (displayIds.indexOf(firstWideId!) + 1) * 10 - 5 }}
          >
            <div className="h-px flex-1 bg-[rgba(255,255,255,0.10)]" />
            <p className="t-subhead whitespace-nowrap">
              Below this line: written across all platforms
            </p>
            <div className="h-px flex-1 bg-[rgba(255,255,255,0.10)]" />
          </div>
        )}

        {/* Hero */}
        <div className="glass p-5 flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <Button data-print="hide" variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(isMoburstStaff ? `/clients/${clientId}/competitive/run` : "/")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <h1 className="t-h1">{clientName} vs. the field</h1>
            <div className="flex items-center gap-2 flex-wrap t-secondary">
              <Badge variant={report.status === "complete" ? "default" : report.status === "failed" ? "destructive" : "secondary"}>{report.status}</Badge>
              {period && <Chip>{period}{rd.period?.days ? ` · ${rd.period.days} days` : ""}</Chip>}
              {rd.landscape?.name && <Chip>RivalIQ · {rd.landscape.name}</Chip>}
              {rivals.length > 0 && <Chip>{rivals.length} competitors</Chip>}
              {effectivePlat !== "all" && <Chip>{platformLabel(effectivePlat)} only</Chip>}
            </div>
          </div>
          <div data-print="hide" className="flex gap-2 flex-wrap">
            <Button variant="ghost" onClick={() => navigate(`/clients/${clientId}/competitive/reports`)}><History className="h-4 w-4 mr-2" /> All runs</Button>
            {isMoburstStaff && (
              <Button variant="ghost" onClick={() => navigate(`/clients/${clientId}/competitive/feed`)}><Rss className="h-4 w-4 mr-2" /> Latest posts</Button>
            )}
            <ExportPdfButton contentRef={printRef} filename={`${clientName.replace(/[^a-z0-9]+/gi, "_")}_competitive_${period ? period.replace(/[^a-z0-9]+/gi, "_") : report.id.slice(0, 8)}`} title={`${clientName} vs. the field${period ? ` (${period})` : ""}`} />
            {report.status === "failed" && (
              <RetryReportButton reportId={report.id} kind="competitive" variant="outline" label="Run again" />
            )}
            <ReportActions
              report={report as any}
              kind="competitive"
              onDeleted={() => navigate(`/clients/${clientId}/competitive/reports`)}
            />
          </div>
        </div>

        {report.status === "failed" && (
          <Card><CardContent className="text-destructive break-words">{String(rd.error || "The run failed before producing a report.")}</CardContent></Card>
        )}

        {/* Platform filter */}
        {hasChannels && (
          <div data-print="hide" className="glass px-5 py-3 flex items-center gap-3 flex-wrap">
            <span className="t-subhead">Platform</span>
            <div className="flex items-center gap-0.5 p-1 rounded-[12px] bg-[rgba(0,0,0,0.2)] border border-[rgba(255,255,255,0.07)]">
              <Seg active={effectivePlat === "all"} onClick={() => setPlat("all")}>All platforms</Seg>
              {platforms.map((k) => <Seg key={k} active={effectivePlat === k} onClick={() => setPlat(k)}>{platformLabel(k)}</Seg>)}
            </div>
            {effectivePlat !== "all" && (
              <span className="t-secondary">
                Every section below says which it is: <span className="!text-[#b9e045]">{platformLabel(effectivePlat)} only</span> where the
                numbers are filtered, <span className="text-white">All platforms</span> where the analysis was written once for the whole account.
              </span>
            )}
          </div>
        )}
        {!hasChannels && companies.length > 0 && (
          <p className="t-secondary">Per-platform breakdowns are produced for runs from September 2, 2026 onward. Re-run the analysis to get them for this client.</p>
        )}


        {/* KPI tiles */}
        {meB && (
          <div className={`grid gap-4 grid-cols-2 md:grid-cols-3 ${meM?.audience ? "2xl:grid-cols-6" : "2xl:grid-cols-5"}`}>
            <Kpi accent label="Benchmark score" value={scorecard ? `${scorecard.client_score}` : "–"} sub="out of 100 vs. the set" />
            {meM?.audience && (
              <StatCard label="Followers" value={compactNumber(meM.audience.current)} delta={{ percent: deltaPct(meM.audience), label: "vs. previous period" }} sub={effectivePlat === "all" ? "across networks, per RivalIQ" : `on ${platformLabel(effectivePlat)}, per RivalIQ`} />
            )}
            <Kpi label="Share of voice" value={shareOfVoice == null ? "–" : `${shareOfVoice.toFixed(0)}%`} sub={`${meB.post_count} of ${totalPosts} posts`} />
            <Kpi label="Cadence" value={`${meB.cadence_per_week}/wk`} sub={`set avg ${avg((b) => b.cadence_per_week).toFixed(1)}/wk`} />
            <Kpi label="Engagement rate" value={pct(meB.engagement_rate_avg)} sub={`set avg ${pct(avg((b) => b.engagement_rate_avg))}`} />
            <Kpi label="Avg engagement" value={fmt(meB.engagement_avg)} sub={`set avg ${fmt(avg((b) => b.engagement_avg))}`} />
          </div>
        )}

        {rd.schema_note && <p className="t-body text-amber-400">{rd.schema_note}</p>}

        {/* Executive summary */}
        {ai.executive_summary && (
            <Section id="summary" index={num("summary")} style={{ order: orderOf("summary") }} title={<>Executive summary</>} action={acrossAll}>
            {/* Plain card: glass-elevated is the opaque grey surface used for
                things that float (the user chip, the progress card), and it
                read as a different material next to every other section. */}
            <Card>
              <CardContent className="pt-5"><Prose text={ai.executive_summary} /></CardContent>
            </Card>
            </Section>
        )}

        {/* Since the last report: movements against the previous comparable report on this landscape */}
        {previous && (
          <Section
            id="changes"
            index={num("changes")}
            style={{ order: orderOf("changes") }}
            title={<><History className="h-5 w-5" /> Since the last report</>}
            description={<>Against the previous report on this landscape, covering {formatRange(periodOf(previous))}. Cadence is per week, so periods of different lengths compare fairly.</>}
            action={acrossAll}
          >
            {changes.length > 0 ? (
              <ChangeCards changes={changes} />
            ) : (
              <div className="glass-inner p-4"><p className="t-body">No notable movement: cadence, engagement, channels and formats all held for every company.</p></div>
            )}
          </Section>
        )}

        {/* Scorecard */}
        {scorecard?.dimensions?.length > 0 && (
            <Section id="scorecard" index={num("scorecard")} style={{ order: orderOf("scorecard") }} title={<><Gauge className="h-5 w-5" /> Where {clientName} stands</>} description={<>Client (bar) versus the competitive set average (marker), per dimension, across all platforms.</>} action={acrossAll}>
            <Card>
              <CardContent className="pt-5 space-y-5">
                {scorecard.dimensions.map((d: any, i: number) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between items-baseline gap-4">
                      <span className="font-medium">{d.dimension}</span>
                      <span className="t-secondary whitespace-nowrap">{d.client} <span className="opacity-60">vs</span> {d.competitor_avg}</span>
                    </div>
                    <div className="relative h-3 rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div className="absolute left-0 top-0 h-3 rounded-full" style={{ width: `${Math.min(100, d.client || 0)}%`, backgroundColor: `rgb(${ACCENT})` }} />
                      <div className="absolute top-[-4px] h-5 w-[3px] rounded bg-white/80" style={{ left: `${Math.min(100, d.competitor_avg || 0)}%` }} title="competitor average" />
                    </div>
                    {d.note && <p className="t-secondary">{nameifyDomains(d.note)}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
            </Section>
        )}

        {/* The field */}
        {companies.length > 0 && (
          <Section
            id="field"
            index={num("field")}
            style={{ order: orderOf("field") }}
            title={<>The field</>}
            action={scopeTag(true)}
            description="Volume, engagement and reach for every company in the landscape. Averages are per post; competitor impressions are RivalIQ estimates."
          >
            <Card>
              <CardContent className="pt-5 grid gap-8 lg:grid-cols-2">
                <div className="space-y-3">
                  <p className="t-subhead">Posts per week</p>
                  <RankedBars emphasis legend={{ subject: clientName, others: "Competitors" }} format={(v) => v.toFixed(1)} rows={ordered.map((c) => ({ key: c.company_id, name: c.name, label: displayCompanyName(c.name), value: Number(bucketFor(c, effectivePlat).cadence_per_week || 0), emphasized: !!c.is_client }))} />
                </div>
                <div className="space-y-3">
                  <p className="t-subhead">Engagement rate</p>
                  <RankedBars emphasis legend={{ subject: clientName, others: "Competitors" }} format={(v) => pct(v)} rows={ordered.map((c) => ({ key: c.company_id, name: c.name, label: displayCompanyName(c.name), value: Number(bucketFor(c, effectivePlat).engagement_rate_avg || 0), emphasized: !!c.is_client }))} />
                </div>
              </CardContent>
            </Card>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {ordered.map((c) => {
                const b = bucketFor(c, effectivePlat);
                const platformNote = platformNoteFor(c.name);
                return (
                  <Card key={c.company_id} className={c.is_client ? "glass-accent" : ""}>
                    <CardHeader className="pb-3">
                      <CardTitle className="t-h3 flex items-center gap-2 flex-wrap" title={c.name}>
                        {displayCompanyName(c.name)}
                        {c.is_client && <Badge>client</Badge>}
                        {c.in_confirmed_top3 && <Badge variant="secondary">top 3</Badge>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {b.post_count === 0 ? (
                        <p className="t-secondary">No posts in this period{effectivePlat !== "all" ? ` on ${platformLabel(effectivePlat)}` : ""}.</p>
                      ) : (
                        // Compact figures: "3,044,225" ran straight out of a
                        // third of a card. The exact number is on the tile.
                        <div className="grid grid-cols-3 gap-3">
                          <TileStat value={String(b.post_count)} label="posts" />
                          <TileStat value={String(b.cadence_per_week)} label="per week" />
                          <TileStat value={pct(b.engagement_rate_avg)} label="eng. rate" />
                          <TileStat value={compactNumber(b.engagement_avg || 0)} exact={fmt(b.engagement_avg)} label="avg engagements" />
                          <TileStat
                            value={compactNumber(b.impressions_avg || (b.post_count ? b.impressions_total / b.post_count : 0))}
                            exact={fmt(b.impressions_avg || (b.post_count ? b.impressions_total / b.post_count : 0))}
                            label="avg est. impressions"
                          />
                          <TileStat value={compactNumber(b.views_total || 0)} exact={fmt(b.views_total)} label="video views" />
                        </div>
                      )}
                      {effectivePlat === "all" && (
                        <div className="flex flex-wrap gap-1.5">
                          {(c.channel_mix || []).map((m) => <Chip key={m.key}>{platformLabel(m.key)} · {m.count}</Chip>)}
                        </div>
                      )}
                      {(b.media_type_mix || []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {b.media_type_mix.slice(0, 4).map((m) => <Chip key={m.key}>{m.key} · {m.count}</Chip>)}
                        </div>
                      )}
                      {platformNote && (
                        <div className="border-t border-[rgba(255,255,255,0.06)] pt-3">
                          <TileNote label={platformLabel(effectivePlat)} text={platformNote} />
                        </div>
                      )}
                      {b.top_hashtags?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                          {b.top_hashtags.slice(0, 6).map((h) => <Chip key={h.key}>{h.key} <span className="text-muted-foreground ml-1">{h.count}</span></Chip>)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {/* How they write and how they look, side by side.
                These read as three paragraphs stacked in every tile, four
                tiles across, which is twelve passages to hold in your head at
                once. Comparing one dimension across the field is the actual
                job, and a row does that in a glance. */}
            {breakdownRows.length > 0 && (
              <Card>
                <CardContent className="pt-5">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="t-subhead text-left align-bottom pb-3 pr-6 w-[92px]"><span className="sr-only">Dimension</span></th>
                          {ordered.map((c) => (
                            <th key={c.company_id} className="text-left align-bottom pb-3 pr-6 last:pr-0 min-w-[240px]">
                              <span className="t-body font-semibold text-white" title={c.name}>{displayCompanyName(c.name)}</span>
                              {c.is_client && <span className="t-label !text-[#b9e045] ml-2">client</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownRows.map((row) => (
                          <tr key={row.label} className="border-t border-[rgba(255,255,255,0.06)] align-top">
                            <th scope="row" className="t-subhead text-left py-4 pr-6">
                              {row.label}
                            </th>
                            {ordered.map((c) => (
                              <td key={c.company_id} className="t-body py-4 pr-6 last:pr-0 min-w-[240px]">
                                {row.valueFor(c.name) ? nameifyDomains(row.valueFor(c.name)!) : <span className="t-label">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </Section>
        )}

        {/* Audience and momentum: RivalIQ's own period totals against the previous period */}
        {hasMetrics && (
          <Section
            id="audience"
            index={num("audience")}
            style={{ order: orderOf("audience") }}
            title={<><Users className="h-5 w-5" /> Audience and momentum</>}
            action={scopeTag(true)}
            description={<>RivalIQ's own totals for the period{previousDays ? ` against the ${previousDays} days before it` : ""}: followers, engagement, estimated impressions and posts for every company.{anyBoosted ? " \"Likely boosted\" is RivalIQ's estimate of paid promotion on Facebook." : ""}</>}
          >
            <Card>
              <CardContent className="pt-5 space-y-6">
                {followersRows.length > 0 && (
                  <div className="space-y-2">
                    <p className="t-subhead">Followers{effectivePlat === "all" ? " across networks" : ""}</p>
                    <RankedBars rows={followersRows} emphasis legend={{ subject: clientName, others: "Competitors" }} />
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {withMetrics.map(({ c, m }) => {
                    const nets = Object.entries(m.by_network).filter(([, n]) => n.followers && n.followers.current > 0);
                    const boosted = m.boosted?.current || 0;
                    return (
                      <article key={c.company_id} className={`glass-inner p-4 space-y-3 min-w-0 ${c.is_client ? "border-[rgba(185,224,69,0.35)]" : ""}`}>
                        <p className="t-h3 pb-3 border-b border-[rgba(255,255,255,0.08)]" title={c.name}>
                          {displayCompanyName(c.name)}
                          {c.is_client && <span className="t-label !text-[#b9e045] ml-2 align-middle">client</span>}
                        </p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                          <MetricRow label="Followers" value={m.audience} signed={c.is_client} />
                          <MetricRow label="Engagement" value={m.engagement} signed={c.is_client} />
                          <MetricRow label="Est. impressions" value={m.impressions} signed={c.is_client} />
                          <MetricRow label="Posts" value={m.posts} format={(v) => String(Math.round(v))} signed={c.is_client} />
                        </div>
                        {nets.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="t-subhead">Followers by network</p>
                            <div className="flex flex-wrap gap-1.5">
                              {nets.map(([net, n]) => <Chip key={net}>{platformLabel(net)} <span className="text-muted-foreground ml-1">{compactNumber(n.followers!.current)}</span></Chip>)}
                            </div>
                          </div>
                        )}
                        {boosted > 0 && (
                          <p className="t-secondary">{boosted} likely boosted Facebook post{boosted === 1 ? "" : "s"} this period{m.boosted?.previous != null ? ` (${m.boosted.previous} before)` : ""}.</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </Section>
        )}

        {/* Posting rhythm */}
        {ordered.some((c) => bucketFor(c, effectivePlat).post_count > 0) && (
            <Section id="rhythm" index={num("rhythm")} style={{ order: orderOf("rhythm") }} title={<><Clock className="h-5 w-5" /> Posting rhythm: you vs. the field</>} description="When each company posts, by weekday and by hour (UTC), against the schedule we recommend." action={scopeTag(true)}>
            <Card>
              <CardContent className="pt-5 space-y-6">
                {/* No summary paragraph here: the analysis wrote out each
                    company's peak hour and its share, which is what the grids
                    below draw. The number now sits on the grid it describes. */}
                <div className="grid gap-6 xl:grid-cols-2">
                {ordered.map((c) => ({ c, b: bucketFor(c, effectivePlat) })).filter((x) => x.b.post_count > 0).map(({ c, b }) => {
                  const peakHour = peakOf(b.by_hour);
                  const peakDay = peakOf(b.by_weekday);
                  return (
                  <div key={c.company_id} className="space-y-3 glass-inner p-4">
                    <div className="t-h3 flex items-center gap-2 flex-wrap pb-3 border-b border-[rgba(255,255,255,0.08)]" title={c.name}>{displayCompanyName(c.name)}{c.is_client && <Badge>client · current rhythm</Badge>}</div>
                    {(peakHour || peakDay) && (
                      <div className="flex flex-wrap gap-x-8 gap-y-2">
                        {peakHour && (
                          <div>
                            <p className="t-h3 tabular-nums text-white">{peakHour.key.padStart(2, "0")}:00 <span className="t-label">UTC</span></p>
                            <p className="t-label">peak hour · {Math.round(peakHour.share * 100)}% of posts</p>
                          </div>
                        )}
                        {peakDay && (
                          <div>
                            <p className="t-h3 text-white">{peakDay.key}</p>
                            <p className="t-label">busiest day · {peakDay.count} post{peakDay.count === 1 ? "" : "s"}</p>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-8 gap-y-4">
                      <div className="min-w-0 shrink-0"><p className="t-subhead mb-1.5">Weekday</p><HeatStrip counts={b.by_weekday} keys={WEEKDAYS} cell={28} /></div>
                      <div className="min-w-0 grow basis-[420px]"><p className="t-subhead mb-1.5">Hour (UTC)</p><HeatStrip counts={b.by_hour} keys={HOURS} labelEvery={3} cell={20} /></div>
                    </div>
                  </div>
                  );
                })}
                </div>

                {schedule && (schedule.by_weekday || schedule.by_hour) && (
                  <div className="glass-inner p-4 space-y-3">
                    <div className="t-h3 flex items-center gap-2 flex-wrap pb-3 border-b border-[rgba(255,255,255,0.08)]">
                      <CalendarCheck className="h-4 w-4" /> Recommended schedule for {clientName}
                      {acrossAll}
                    </div>
                    {/* The reasoning sits beside the schedule it explains. Under
                        it, the block ran half empty: the strips stop at 830px
                        and the prose stops at its measure, leaving a third of
                        the card blank. */}
                    <div className="grid gap-x-10 gap-y-4 2xl:grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start">
                      <div className="flex flex-wrap gap-x-8 gap-y-4">
                        {schedule.by_weekday && <div className="min-w-0 shrink-0"><p className="t-subhead mb-1.5">Posts per weekday</p><HeatStrip counts={schedule.by_weekday} keys={WEEKDAYS} cell={28} color={RECOMMEND} /></div>}
                        {schedule.by_hour && <div className="min-w-0 grow basis-[420px]"><p className="t-subhead mb-1.5">Posts per hour (UTC)</p><HeatStrip counts={schedule.by_hour} keys={HOURS} labelEvery={3} cell={20} color={RECOMMEND} /></div>}
                      </div>
                      {schedule.rationale && <Prose text={schedule.rationale} className="t-body" />}
                    </div>
                  </div>
                )}

                {ai.posting_time_insights?.empty_airtime && (
                  // The callout hugs its text. Stretched to the full card it held a
                  // readable measure beside 680px of empty accent panel.
                  <div className="glass-accent p-4 w-fit max-w-full">
                    <p className="t-subhead mb-1">Empty airtime</p>
                    <Prose text={ai.posting_time_insights.empty_airtime} className="t-body" />
                  </div>
                )}
              </CardContent>
            </Card>
            </Section>
        )}

        {/* Gaps */}
        {(gaps.length > 0 || hiddenGaps.length > 0) && (
          <Section
            id="gaps"
            index={num("gaps")}
            style={{ order: orderOf("gaps") }}
            title={<><Lightbulb className="h-5 w-5" /> Gaps {clientName} can fill</>}
            description={
              <span data-print={isMoburstStaff ? "hide" : undefined}>
                {isMoburstStaff ? "Thumbs up sends a gap into the next monthly report and content calendar. Thumbs down hides it and stops it being proposed again." : "Opportunities your account team is reviewing."}
              </span>
            }
            action={
              <>
                {scopeTag(true)}
                {isMoburstStaff && hiddenGaps.length > 0 && (
                  <Button data-print="hide" variant="ghost" size="sm" onClick={() => setShowHidden((v) => !v)}>
                    <Eye className="h-4 w-4 mr-1" /> {showHidden ? "Hide" : "Show"} {hiddenGaps.length} hidden suggestion{hiddenGaps.length === 1 ? "" : "s"}
                  </Button>
                )}
              </>
            }
          >
            {gaps.length === 0 && <div className="glass-inner p-4"><p className="t-body">Every suggestion for this view has been hidden by the team.</p></div>}
            <div className="grid gap-4 md:grid-cols-2">
              {gaps.map((g: any, i: number) => {
                const v = verdictFor(g.gap);
                return (
                  <Card key={i} className={v === "up" ? "glass-accent" : ""}>
                    <CardContent className="pt-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 h-7 w-7 rounded-full bg-primary text-primary-foreground t-badge flex items-center justify-center mt-0.5">{i + 1}</span>
                        <div className="min-w-0 space-y-1.5">
                          <p className="t-h3 leading-snug">{nameifyDomains(g.gap)}</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {g.platform && <Badge variant="outline">{g.platform === "all" ? "All platforms" : platformLabel(g.platform)}</Badge>}
                            {v === "up" && <Badge className="gap-1"><ThumbsUp className="h-3 w-3" /> in the calendar brief</Badge>}
                          </div>
                        </div>
                      </div>
                      {g.why_it_matters && <p className="t-body">{nameifyDomains(g.why_it_matters)}</p>}
                      {g.suggested_play && (
                        <div className="glass-accent p-3 t-body">
                          <span className="font-semibold">The play: </span>{nameifyDomains(g.suggested_play)}
                        </div>
                      )}
                      {isMoburstStaff && (
                        <div data-print="hide" className="flex items-center gap-2 pt-1">
                          <Button size="sm" variant={v === "up" ? "default" : "outline"} onClick={() => castVote(g, "up")} aria-pressed={v === "up"}>
                            <ThumbsUp className="h-4 w-4 mr-1.5" /> {v === "up" ? "Implementing" : "Implement"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => castVote(g, "down")} aria-label="Hide this suggestion">
                            <ThumbsDown className="h-4 w-4 mr-1.5" /> Not for us
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {isMoburstStaff && showHidden && hiddenGaps.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="t-h3 flex items-center gap-2">Hidden suggestions</CardTitle>
                    <CardDescription>Excluded from future runs and from the monthly report brief.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {hiddenGaps.map((g: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-3 t-body">
                        <span className="text-muted-foreground line-through">{g.gap}</span>
                        <Button size="sm" variant="ghost" onClick={() => castVote(g, "down")}><RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore</Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
            )}
          </Section>
        )}

        {/* Winner teardown */}
        {/* Kept on screen when a filter empties it: a section that vanishes is
            its own kind of confusing, and the rail loses its place too. */}
        {(teardowns.length > 0 || (effectivePlat !== "all" && Array.isArray(ai.winner_teardown) && ai.winner_teardown.length > 0)) && (
            <Section id="wins" index={num("wins")} style={{ order: orderOf("wins") }} title={<><Trophy className="h-5 w-5" /> What wins for them</>}
            action={scopeTag(true)} description={<>The repeatable pattern behind each competitor's best posts, with the posts that prove it.</>}>
            <Card>
              <CardContent className={teardowns.length > 0 ? "pt-5 grid gap-4 md:grid-cols-3" : "pt-5"}>
                {teardowns.length === 0 && (
                  <p className="t-body">
                    None of the posts behind these patterns are on {platformLabel(effectivePlat)}. Switch to all platforms to read them.
                  </p>
                )}
                {teardowns.map((w: any, i: number) => {
                  const examples: Array<{ url: string; post?: TopPost }> = w.examples;
                  return (
                    <div key={i} className="glass-inner p-4 space-y-3">
                      <p className="t-h3 pb-3 border-b border-[rgba(255,255,255,0.08)]" title={w.competitor}>{displayCompanyName(w.competitor)}</p>
                      {/* The pattern is the claim, and the only prose here. */}
                      <p className="t-body text-white leading-[1.55] pt-0.5">{w.pattern}</p>
                      {/* The proof, as the numbers rather than a paragraph
                          reciting them. The analysis used to write out "hit
                          41,317 engagements … 3,000 comments … 261 shares" for
                          posts the report already holds in full, which is a
                          wall of text saying what a row of figures says. */}
                      {examples.length > 0 && (
                        <div className="space-y-2 pt-1">
                          {examples.map((ex, j) => (
                            <a
                              key={j}
                              href={ex.url}
                              target="_blank"
                              rel="noreferrer"
                              className="group flex gap-3 rounded-[10px] p-1.5 -m-1.5 hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                            >
                              <PostVisual
                                url={null}
                                image={ex.post?.image}
                                preview={previews[ex.url]}
                                mediaType={ex.post?.media_type}
                                platform={ex.post?.channel}
                                className="w-16 shrink-0"
                                compact
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-2 flex-wrap">
                                  <span className="t-body font-semibold text-white tabular-nums">{ex.post ? fmt(ex.post.engagement) : "–"}</span>
                                  <span className="t-label">engagements</span>
                                  {ex.post?.engagement_rate ? <span className="t-label">· {pct(ex.post.engagement_rate)} ER</span> : null}
                                </span>
                                <span className="t-label block mt-0.5">
                                  {ex.post?.channel ? platformLabel(ex.post.channel) : "Post"}
                                  {ex.post?.media_type ? ` · ${ex.post.media_type}` : ""}
                                  {ex.post?.likely_boosted ? " · likely boosted" : ""}
                                </span>
                                {ex.post && (ex.post.applause || ex.post.conversation || ex.post.amplification) ? (
                                  <span className="t-label block mt-0.5 tabular-nums">
                                    {fmt(ex.post.applause || 0)} likes · {fmt(ex.post.conversation || 0)} comments · {fmt(ex.post.amplification || 0)} shares
                                  </span>
                                ) : null}
                              </span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#6b7280] group-hover:text-white transition-colors" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            </Section>
        )}

        {/* Mood boards */}
        {ordered.some((c) => moodPosts(c).length > 0) && (
            <Section id="moodboards" index={num("moodboards")} style={{ order: orderOf("moodboards") }} action={scopeTag(true)} title={<><Images className="h-5 w-5" /> Mood boards</>} description={<>The creative each company actually ran in the period, side by side. Click any tile to open the post.</>}>
            <Card>
              <CardContent className="pt-5 space-y-6">
                {ordered.map((c) => {
                  const posts = moodPosts(c).filter(hasContent);
                  if (!posts.length) return null;
                  return (
                    <div key={c.company_id} className="space-y-2">
                      <p className="t-h3 flex items-center gap-2 flex-wrap" title={c.name}>{displayCompanyName(c.name)}{c.is_client && <Badge>client</Badge>}</p>
                      <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                        {posts.map((p, i) => <PostVisual key={i} url={p.url} image={p.image} preview={p.url ? previews[p.url] : null} mediaType={p.media_type} platform={p.channel} compact />)}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            </Section>
        )}

        {/* Top posts */}
        {ordered.some((c) => bucketFor(c, effectivePlat).top_posts?.length) && (
            <Section id="posts" index={num("posts")} style={{ order: orderOf("posts") }} action={scopeTag(true)} title={<><Layers className="h-5 w-5" /> Top 5 posts per company</>} description={<>Ranked by total engagement in the period. Post-level figures come straight from RivalIQ; competitor impressions are estimates.</>}>
            <Card>
              <CardContent className="pt-5 space-y-8">
                {ordered.map((c) => ({ c, b: bucketFor(c, effectivePlat) })).filter((x) => x.b.top_posts?.length).map(({ c, b }) => (
                  <div key={c.company_id} className="space-y-3">
                    <p className="t-h3 flex items-center gap-2 flex-wrap" title={c.name}>{displayCompanyName(c.name)}{c.is_client && <Badge>client</Badge>}</p>
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 items-start">
                      {b.top_posts.filter(hasContent).slice(0, 5).map((p, i) => postCard(p, `${c.company_id}-${i}`))}
                      {b.top_posts.filter((p) => !hasContent(p)).length > 0 && (
                        <p className="t-label col-span-full">{b.top_posts.filter((p) => !hasContent(p)).length} X {b.top_posts.filter((p) => !hasContent(p)).length === 1 ? "post is" : "posts are"} counted in the totals only: RivalIQ sends no link, caption or image for X.</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            </Section>
        )}
      </div>
    </AppLayout>
  );
}
