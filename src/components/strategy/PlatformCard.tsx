/**
 * 05 Platforms: a card per platform posting now or new, its role, its cadence
 * and today's numbers, what we post, the posts that worked (real posts, with
 * their multiple of the usual), and behind disclosures the first 30 days (new
 * platforms) and the checks at 30 and 90 days. Not now is one line each.
 */

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { PlatformBadge } from "@/lib/platform-config";
import { formatDate } from "@/lib/display";
import { basisChip, cadenceWords, figure, stateWords, textLines, type PagePlatform } from "@/lib/strategyView";
import type { NotNowValue, PlatformValue } from "../../../supabase/functions/_shared/strategy/sections";
import { EditButton, EditedChip, useSectionEdit, type SectionProps } from "./StrategySection";
import { EditSheet } from "./EditSheet";
import { figuresOf } from "./Baseline";

const multiple = (n: number) => `${Math.round(n * 10) / 10}x`;
const METRIC: Record<string, string> = { engagement: "engagement", impressions: "impressions" };

export function PlatformCard({ p, ...props }: SectionProps & { p: PagePlatform }) {
  const e = useSectionEdit(props);
  const text = typeof e.shown === "string" ? textLines(e.shown) : null;
  const v = (e.shown ?? {}) as Partial<PlatformValue>;
  const f = figuresOf(p);
  const cadence = cadenceWords(p.cadence);
  return (
    <article className="glass p-card space-y-4 min-w-0 break-inside-avoid" data-testid={`strategy-platform-${p.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <PlatformBadge platform={p.platform} />
          <Badge variant="outline">{stateWords(p.state)}</Badge>
          {f?.known && <Badge variant="outline">{basisChip(f.basis)}</Badge>}
        </div>
        <div className="flex items-center gap-2"><EditedChip e={e} /><EditButton e={e} label={p.platform} /></div>
      </div>
      {text ? <ul className="space-y-2">{text.map((l, i) => <li key={i} className="t-read">{l}</li>)}</ul> : (
        <>
          {v.role && <h3 className="t-h3">{v.role}</h3>}
          <StatGrid min={130}>
            <StatCard size="compact" label="Cadence" value={cadence || "None yet"} />
            <StatCard size="compact" label="Engagement per post" value={f && f.basis !== "thin" ? figure(f.median_engagement) : "None yet"} />
            <StatCard size="compact" label="Followers" value={figure(f?.followers ?? null)} />
          </StatGrid>
          {!!v.post?.length && (
            <div className="space-y-2">
              <p className="t-label">What we post</p>
              <ul className="space-y-1.5 list-disc pl-5 marker:text-[#b9e045]">{v.post.map((x, i) => <li key={i} className="t-read">{x}</li>)}</ul>
            </div>
          )}
          {!!v.worked?.length && (
            <div className="space-y-2">
              <p className="t-label">What worked</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {v.worked.slice(0, 2).map((w, i) => (
                  <div key={i} className="glass-inner p-inner space-y-1.5 min-w-0">
                    <p className="t-label">{formatDate(w.date, { year: false })} · {multiple(w.multiple)} the usual {METRIC[w.metric] ?? "engagement"}</p>
                    <p className="t-body line-clamp-3">{w.text}</p>
                    {w.link && <a className="t-link inline-flex items-center gap-1" href={w.link} target="_blank" rel="noopener noreferrer">Open the post <ExternalLink className="h-3 w-3" aria-hidden /></a>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!!v.first_30?.length && (
            <details className="glass-inner p-inner">
              <summary className="t-body cursor-pointer select-none">First 30 days</summary>
              <ol className="mt-3 space-y-2">{v.first_30.map((w, i) => <li key={i} className="t-read"><span className="t-label mr-2">Week {i + 1}</span>{w}</li>)}</ol>
            </details>
          )}
          {(v.checks?.day_30 || v.checks?.day_90) && (
            <details className="glass-inner p-inner">
              <summary className="t-body cursor-pointer select-none">Checks at 30 and 90 days</summary>
              <dl className="mt-3 space-y-2">
                {v.checks?.day_30 && <div><dt className="t-label">At 30 days</dt><dd className="t-read">{v.checks.day_30}</dd></div>}
                {v.checks?.day_90 && <div><dt className="t-label">At 90 days</dt><dd className="t-read">{v.checks.day_90}</dd></div>}
              </dl>
            </details>
          )}
        </>
      )}
      <EditSheet e={e} title={p.platform} />
    </article>
  );
}

export function NotNow(props: SectionProps) {
  const e = useSectionEdit(props);
  const rows = typeof e.shown === "string"
    ? textLines(e.shown).map((line) => { const at = line.indexOf(":"); return at > 0 ? { platform: line.slice(0, at), reason: line.slice(at + 1).trim() } : { platform: "", reason: line }; })
    : ((e.shown as Partial<NotNowValue> | undefined)?.items ?? []);
  if (!rows.length) return null;
  return (
    <article className="glass p-card space-y-3 min-w-0 break-inside-avoid" data-testid="strategy-not-now">
      <div className="flex items-start justify-between gap-3">
        <p className="t-subhead pt-1.5">Not now</p>
        <div className="flex items-center gap-2"><EditedChip e={e} /><EditButton e={e} label="not now" /></div>
      </div>
      <ul className="space-y-2.5">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {r.platform && <PlatformBadge platform={r.platform} size="sm" />}
            <span className="t-read min-w-0">{r.reason}</span>
          </li>
        ))}
      </ul>
      <EditSheet e={e} title="Not now" />
    </article>
  );
}
