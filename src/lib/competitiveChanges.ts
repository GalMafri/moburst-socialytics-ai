// Change detection over the RivalIQ history (Milestone 4). Two aggregates of the
// same landscape go in (two monthly reports, or two weekly feed pulls); the
// movements worth a sentence come out, the client's first, biggest move first.
// Cadence is per week so periods of different lengths compare fairly.

import { normalizePlatform, platformLabel } from "@/components/competitive/PostVisual";

export type MixEntry = { key: string; count: number };
export type CompanyStats = {
  name: string;
  is_client: boolean;
  post_count: number;
  cadence_per_week: number;
  engagement_avg: number;
  engagement_rate_avg: number;
  channel_mix: MixEntry[];
  media_type_mix: MixEntry[];
};
export type Period = { start: string; end: string };
export type Change = {
  company: string;
  is_client: boolean;
  kind: "cadence" | "engagement" | "engagement_rate" | "channel_new" | "channel_dropped" | "format" | "quiet" | "new_company";
  headline: string;
  detail: string;
  /** Relative size of the move, used for ordering. */
  magnitude: number;
  direction: "up" | "down" | "flat";
  /** How the move reads for the client: its own gains and losses are coloured, competitor moves stay neutral. */
  tone: "good" | "bad" | "neutral";
};

const DAY = 86400000;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pctText = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const rateText = (v: number) => `${(v * 100).toFixed(2)}%`;
const perPost = (v: number) => Math.round(v).toLocaleString();
const FORMAT_LABEL: Record<string, string> = { reel: "Reels", video: "video", photo: "photos", image: "images", carousel: "carousels", story: "Stories", link: "link posts", text: "text posts" };
const lower = (s: string) => s.toLowerCase().trim();

/** Fraction of the shorter period that the two periods share: 0 when disjoint, 1 when nested. */
export function periodOverlap(a: Period, b: Period): number {
  const as = Date.parse(a.start), ae = Date.parse(a.end), bs = Date.parse(b.start), be = Date.parse(b.end);
  if ([as, ae, bs, be].some((t) => Number.isNaN(t))) return 1;
  const overlap = Math.min(ae, be) - Math.max(as, bs) + DAY;
  const shorter = Math.min(ae - as, be - bs) + DAY;
  return shorter <= 0 ? 1 : Math.max(0, overlap) / shorter;
}

/** True when `prev` starts before `curr` and they share at most a quarter of the shorter period. */
export function comparablePeriods(prev: Period | null | undefined, curr: Period | null | undefined): boolean {
  if (!prev?.start || !prev?.end || !curr?.start || !curr?.end) return false;
  return Date.parse(prev.start) < Date.parse(curr.start) && periodOverlap(prev, curr) <= 0.25;
}

type RawPost = { companyId?: string | number; companyName?: string; channel?: string; type?: string; engagementTotal?: number | string; engagementRate?: number | string };

/** Per-company stats from raw RivalIQ posts (the feed snapshots), on the same fields the report aggregates carry. */
export function aggregatePosts(posts: RawPost[], days: number, clientName?: string): CompanyStats[] {
  type Acc = CompanyStats & { engSum: number; rateSum: number; ch: Record<string, number>; mt: Record<string, number> };
  const by = new Map<string, Acc>();
  const needle = lower(clientName || "");
  for (const p of posts || []) {
    const name = String(p.companyName || p.companyId || "Unknown");
    let c = by.get(name);
    if (!c) {
      const isClient = !!needle && (lower(name).includes(needle) || needle.includes(lower(name)));
      c = { name, is_client: isClient, post_count: 0, cadence_per_week: 0, engagement_avg: 0, engagement_rate_avg: 0, channel_mix: [], media_type_mix: [], engSum: 0, rateSum: 0, ch: {}, mt: {} };
      by.set(name, c);
    }
    c.post_count += 1;
    c.engSum += num(p.engagementTotal);
    c.rateSum += num(p.engagementRate);
    const ch = lower(String(p.channel || "unknown"));
    c.ch[ch] = (c.ch[ch] || 0) + 1;
    const mt = lower(String(p.type || "unknown"));
    c.mt[mt] = (c.mt[mt] || 0) + 1;
  }
  const span = Math.max(1, days);
  const toMix = (o: Record<string, number>) => Object.entries(o).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  return Array.from(by.values()).map((c) => ({
    name: c.name,
    is_client: c.is_client,
    post_count: c.post_count,
    cadence_per_week: Math.round((c.post_count / span) * 7 * 10) / 10,
    engagement_avg: c.post_count ? c.engSum / c.post_count : 0,
    engagement_rate_avg: c.post_count ? c.rateSum / c.post_count : 0,
    channel_mix: toMix(c.ch),
    media_type_mix: toMix(c.mt),
  }));
}

/** The companies of a competitive report, on the shared stats shape. */
export function companiesFromReport(rd: any): CompanyStats[] {
  const list: any[] = Array.isArray(rd?.aggregates?.companies) ? rd.aggregates.companies : [];
  return list.map((c) => ({
    name: String(c.name || c.company_id || "Unknown"),
    is_client: !!c.is_client,
    post_count: num(c.post_count),
    cadence_per_week: num(c.cadence_per_week),
    engagement_avg: num(c.engagement_avg),
    engagement_rate_avg: num(c.engagement_rate_avg),
    channel_mix: Array.isArray(c.channel_mix) ? c.channel_mix : [],
    media_type_mix: Array.isArray(c.media_type_mix) ? c.media_type_mix : [],
  }));
}

type ReportLike = { report_data?: any; date_range_start?: string | null; date_range_end?: string | null };

export function reportPeriod(r: ReportLike | null | undefined): Period | null {
  const p = r?.report_data?.period;
  const start = p?.start || r?.date_range_start;
  const end = p?.end || r?.date_range_end;
  return start && end ? { start: String(start), end: String(end) } : null;
}

/** The newest earlier report on the same landscape whose period sits before this one. */
export function pickComparableReport<T extends ReportLike>(current: T, candidates: T[]): T | null {
  const landscape = String(current?.report_data?.landscape?.id ?? "");
  const cur = reportPeriod(current);
  for (const c of candidates) {
    if (String(c?.report_data?.landscape?.id ?? "") !== landscape) continue;
    if (comparablePeriods(reportPeriod(c), cur)) return c;
  }
  return null;
}

function mix(entries: MixEntry[] | undefined, norm: (k: string) => string = lower): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries || []) {
    const k = norm(String(e.key));
    if (!k) continue;
    out[k] = (out[k] || 0) + num(e.count);
  }
  return out;
}

/** The movements between two periods worth telling the reader about. */
export function diffCompanies(prev: CompanyStats[], curr: CompanyStats[], max = 9): Change[] {
  const prevBy = new Map(prev.map((c) => [lower(c.name), c]));
  const out: Change[] = [];
  for (const c of curr) {
    const p = prevBy.get(lower(c.name));
    const who = c.name;
    const mine = c.is_client;
    if (!p) {
      if (c.post_count > 0) {
        out.push({ company: who, is_client: mine, kind: "new_company", headline: `${who} joined the landscape`, detail: `${c.post_count} post${c.post_count === 1 ? "" : "s"} this period; not in the previous one.`, magnitude: 0.5, direction: "flat", tone: "neutral" });
      }
      continue;
    }
    if (p.post_count >= 3 && c.post_count === 0) {
      out.push({ company: who, is_client: mine, kind: "quiet", headline: `${who} went quiet`, detail: `No posts this period after ${p.post_count} in the previous one.`, magnitude: 1, direction: "down", tone: mine ? "bad" : "neutral" });
      continue;
    }
    if (p.post_count + c.post_count >= 4) {
      const a = p.cadence_per_week, b = c.cadence_per_week;
      const rel = a > 0 ? (b - a) / a : b > 0 ? 1 : 0;
      if (Math.abs(b - a) >= 1 && Math.abs(rel) >= 0.3) {
        const up = b > a;
        const headline = up && a > 0 && b / a >= 1.5 ? `${who} posts ${(b / a).toFixed(1)}× as often` : `${who} posts ${pctText(rel)} ${up ? "more" : "less"} often`;
        out.push({ company: who, is_client: mine, kind: "cadence", headline, detail: `${b.toFixed(1)} posts a week, ${up ? "up" : "down"} from ${a.toFixed(1)} in the previous period.`, magnitude: Math.abs(rel), direction: up ? "up" : "down", tone: "neutral" });
      }
    }
    if (p.post_count >= 3 && c.post_count >= 3) {
      const a = p.engagement_rate_avg, b = c.engagement_rate_avg;
      const rel = a > 0 ? (b - a) / a : 0;
      if (Math.abs(rel) >= 0.3 && Math.abs(b - a) >= 0.003) {
        const up = b > a;
        out.push({ company: who, is_client: mine, kind: "engagement_rate", headline: `${who}'s engagement rate ${up ? "rose" : "fell"} to ${rateText(b)}`, detail: `From ${rateText(a)} in the previous period, across ${c.post_count} posts.`, magnitude: Math.abs(rel), direction: up ? "up" : "down", tone: mine ? (up ? "good" : "bad") : "neutral" });
      } else {
        const ea = p.engagement_avg, eb = c.engagement_avg;
        const erel = ea > 0 ? (eb - ea) / ea : 0;
        if (Math.abs(erel) >= 0.4 && Math.abs(eb - ea) >= 5) {
          const up = eb > ea;
          out.push({ company: who, is_client: mine, kind: "engagement", headline: `${who}'s engagement per post ${up ? "rose" : "fell"} ${pctText(erel)}`, detail: `${perPost(eb)} per post, from ${perPost(ea)} in the previous period.`, magnitude: Math.abs(erel), direction: up ? "up" : "down", tone: mine ? (up ? "good" : "bad") : "neutral" });
        }
      }
    }
    const pc = mix(p.channel_mix, (k) => normalizePlatform(k) || lower(k));
    const cc = mix(c.channel_mix, (k) => normalizePlatform(k) || lower(k));
    if (p.post_count >= 3) {
      for (const [ch, n] of Object.entries(cc)) {
        if (n >= 2 && !pc[ch]) out.push({ company: who, is_client: mine, kind: "channel_new", headline: `${who} moved onto ${platformLabel(ch)}`, detail: `${n} posts there this period, none in the previous one.`, magnitude: 0.6 + Math.min(0.4, n / 20), direction: "up", tone: "neutral" });
      }
    }
    if (c.post_count >= 3) {
      for (const [ch, n] of Object.entries(pc)) {
        if (n >= 2 && !cc[ch]) out.push({ company: who, is_client: mine, kind: "channel_dropped", headline: `${who} left ${platformLabel(ch)}`, detail: `No posts there this period after ${n} in the previous one.`, magnitude: 0.6 + Math.min(0.4, n / 20), direction: "down", tone: "neutral" });
      }
    }
    if (p.post_count >= 5 && c.post_count >= 5) {
      const pm = mix(p.media_type_mix), cm = mix(c.media_type_mix);
      let best: { k: string; d: number; a: number; b: number } | null = null;
      for (const k of new Set([...Object.keys(pm), ...Object.keys(cm)])) {
        if (k === "unknown") continue;
        const a = (pm[k] || 0) / p.post_count, b = (cm[k] || 0) / c.post_count;
        if (Math.abs(b - a) >= 0.2 && (!best || Math.abs(b - a) > Math.abs(best.d))) best = { k, d: b - a, a, b };
      }
      if (best) {
        const label = FORMAT_LABEL[best.k] || best.k;
        const up = best.d > 0;
        out.push({ company: who, is_client: mine, kind: "format", headline: `${who} shifted ${up ? "toward" : "away from"} ${label}`, detail: `${label[0].toUpperCase()}${label.slice(1)} is ${Math.round(best.b * 100)}% of posts, ${up ? "up" : "down"} from ${Math.round(best.a * 100)}%.`, magnitude: Math.abs(best.d), direction: up ? "up" : "down", tone: "neutral" });
      }
    }
  }
  return out.sort((x, y) => Number(y.is_client) - Number(x.is_client) || y.magnitude - x.magnitude).slice(0, max);
}
