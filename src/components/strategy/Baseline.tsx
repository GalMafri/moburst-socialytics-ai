/**
 * 02 Where we start: per platform, today's numbers (followers, posts a week,
 * median engagement per post, and the rate the data allows: per impression
 * with Sprout, per view on public TikTok and YouTube), and the brand against
 * its tracked competitors from the same read, the brand in lime. How each
 * platform is measured sits behind a disclosure, which the PDF opens.
 */

import { Badge } from "@/components/ui/badge";
import { RankedBars } from "@/components/ui/bars";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlatformBadge } from "@/lib/platform-config";
import { basisChip, figure, percentOf, rateLabel, type PagePlatform } from "@/lib/strategyView";
import { metricWords, type Goal } from "../../../supabase/functions/_shared/strategy/sections";
import type { PlatformFigures } from "../../../supabase/functions/_shared/strategy/basis";
import { EditButton, EditedChip, useSectionEdit, type SectionProps } from "./StrategySection";
import { EditSheet } from "./EditSheet";

/** A platform's figures; a strategy written on 2 Nov has only its 90-day baseline. */
export function figuresOf(p: PagePlatform): (PlatformFigures & { known: boolean }) | null {
  if (p.figures) return { ...p.figures, known: true };
  if (!p.baseline) return null;
  return {
    platform: p.platform, basis: "measured", posts: p.baseline.posts, posts_per_week: p.baseline.posts_per_week, median_engagement: p.baseline.median_engagement,
    rate: p.baseline.engagement_rate, rate_kind: p.baseline.engagement_rate === null ? null : "impression", followers: null, known: false,
  };
}

function Comparison({ client, p, f }: { client: string; p: PagePlatform; f: PlatformFigures }) {
  const comps = p.competitors ?? [];
  if (!comps.length || f.basis === "none") return null;
  const bars = (title: string, mine: number | null, theirs: (c: (typeof comps)[number]) => number | null, legend: boolean) => {
    const rows = [
      ...(mine === null ? [] : [{ key: "brand", label: client, name: client, value: mine, emphasized: true }]),
      ...comps.flatMap((c) => { const v = theirs(c); return v === null ? [] : [{ key: c.company, label: c.company, name: c.company, value: v }]; }),
    ];
    if (rows.length < 2) return null;
    return (
      <div className="space-y-3 min-w-0">
        <p className="t-subhead">{title}</p>
        <RankedBars rows={rows} emphasis legend={legend ? { subject: client, others: "Competitors" } : undefined} />
      </div>
    );
  };
  const engagement = bars("Engagement per post", f.basis === "thin" ? null : f.median_engagement, (c) => c.median_engagement, true);
  return (
    // One measure above the other, the legend once under both: side by side, the bars were too short to compare.
    <div className="space-y-5" data-testid={`strategy-compare-${p.key}`}>
      {bars("Posts a week", f.posts_per_week, (c) => c.posts_per_week, !engagement)}
      {engagement}
    </div>
  );
}

export function PlatformStart({ client, p }: { client: string; p: PagePlatform }) {
  const f = figuresOf(p);
  if (!f) return null;
  return (
    <article className="glass p-card space-y-4 min-w-0 break-inside-avoid" data-testid={`strategy-start-${p.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <PlatformBadge platform={p.platform} />
        {f.known && <Badge variant="outline">{basisChip(f.basis)}</Badge>}
      </div>
      {/* Short labels with the measure under the figure, so a tile never cuts its own name off at phone width. */}
      <StatGrid min={120}>
        <StatCard size="compact" label="Followers" value={figure(f.followers)} />
        <StatCard size="compact" label="Posts a week" value={figure(f.posts_per_week)} />
        <StatCard size="compact" label="Engagement" value={f.basis === "thin" ? "Too few posts" : figure(f.median_engagement)} sub="median per post" />
        {f.rate_kind && <StatCard size="compact" label="Rate" value={percentOf(f.rate)} sub={rateLabel(f.rate_kind)} />}
      </StatGrid>
      <Comparison client={client} p={p} f={f} />
    </article>
  );
}

const MEASURED_BY: Record<string, string> = { measured: "Impressions, reach and engagement from Sprout", public: "Public posts and their engagement", thin: "A few public posts, so only posts a week and followers", none: "No public posts yet, so posts a week" };

/** How each platform is measured, from the goals and the data basis, and a 2 Nov measures section or a person's version of it. */
export function Measures({ platforms, goals, ...props }: SectionProps & { platforms: PagePlatform[]; goals: Goal[] }) {
  const e = useSectionEdit(props);
  const text = typeof e.shown === "string" ? e.shown.trim() : "";
  const rows = platforms.filter((p) => p.state !== "not_now").map((p) => ({ p, f: figuresOf(p), goals: goals.filter((g) => g.platform === p.platform) }));
  return (
    <details className="glass p-card group" data-testid="strategy-measures">
      <summary className="t-h4 cursor-pointer select-none">How each platform is measured</summary>
      <div className="mt-4 space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Platform</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>What the goals measure</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ p, f, goals: g }) => (
              <TableRow key={p.key}>
                <TableCell><PlatformBadge platform={p.platform} size="sm" /></TableCell>
                <TableCell className="t-body">{f?.known ? MEASURED_BY[f.basis] : "From the client's posts"}</TableCell>
                <TableCell className="t-body">{g.length ? g.map((x) => `${metricWords(x.metric)}, ${x.direction}`).join("; ") : "Posts a week"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {text && (
          <div className="glass-inner p-inner space-y-2">
            <div className="flex items-start justify-between gap-3">
              <p className="t-subhead pt-1.5">The team's measures</p>
              <div className="flex items-center gap-2"><EditedChip e={e} /><EditButton e={e} label="the measures" /></div>
            </div>
            <p className="t-read whitespace-pre-line">{text}</p>
          </div>
        )}
      </div>
      <EditSheet e={e} title="Measures" />
    </details>
  );
}
