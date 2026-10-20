/**
 * One client's status at a glance on the Dashboard: how the last month went,
 * where they stand against competitors, this week's content, and what needs
 * doing. Deliberately high level; every tile links to the page with the
 * detail (Analytics, the reports, the Calendar) instead of repeating it.
 */

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CheckCircle2, CircleAlert, Crosshair, Info, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Loading } from "@/components/ui/loading";
import { compactNumber } from "@/components/ui/bars";
import { formatPercentChange } from "@/components/ui/stat-card";
import { firstRunSentence, formatRange } from "@/lib/display";
import { displayCompanyName } from "@/lib/companyName";
import { thisWeek } from "@/lib/weekWindow";
import { fetchOpenTopics } from "@/lib/openTopics";
import { fetchNextRun } from "@/lib/nextRun";
import { buildCompetitiveContext } from "@/components/competitive/CompetitiveSnapshot";
import { competitiveReportQuality } from "../../../supabase/functions/_shared/competitive/reportEvidence";
import { actionItems, competitiveStanding, contentWeek, reportHeadline, type PostMedia, type WeekPost } from "@/lib/clientOverview";

const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function ClientOverview({ clientId, isStaff }: { clientId: string; isStaff: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["client-overview", clientId, isStaff],
    queryFn: async () => {
      const { data: client } = await supabase.from("clients").select("id, name, timezone").eq("id", clientId).maybeSingle();
      const timeZone = client?.timezone || "UTC";
      // "This week" is Monday to Sunday in the client's time zone, as on the calendar.
      const week = thisWeek(timeZone);
      const [report, competitive, feedback, posts, media, topics, nextMonthly, nextCompetitive] = await Promise.all([
        supabase.from("reports").select("id, report_data, date_range_start, date_range_end, created_at").eq("client_id", clientId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("competitive_reports").select("id, created_at, report_data").eq("client_id", clientId).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("competitive_insight_feedback").select("insight_key, verdict, gap_text, edited").eq("client_id", clientId),
        // The calendar shows each week's plan in force, never the raw posts table.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from("calendar_posts" as never) as any).select("id, post_key, post_date, platform, source, copy").eq("client_id", clientId).gte("post_date", week.start).order("post_date").limit(200),
        supabase.from("post_iterations").select("calendar_post_key, is_selected, is_approved, media_urls").eq("client_id", clientId).is("rejected_at", null).is("archived_at", null).not("calendar_post_key", "is", null),
        // The one definition of open topics, shared with the feed page and the planner.
        isStaff ? fetchOpenTopics(clientId).catch(() => []) : Promise.resolve([]),
        fetchNextRun(clientId, "monthly").catch(() => null),
        fetchNextRun(clientId, "competitive").catch(() => null),
      ]);
      const compRow = competitive.data && competitiveReportQuality(competitive.data.report_data).ready ? competitive.data : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fb = (feedback.data || []) as any[];
      const content = contentWeek((posts.data || []) as WeekPost[], (media.data || []) as PostMedia[], week);
      return {
        week,
        report: report.data,
        headline: report.data ? reportHeadline(report.data.report_data) : null,
        competitive: compRow,
        standing: compRow ? competitiveStanding(buildCompetitiveContext(compRow, fb)) : null,
        content,
        firstMonthly: firstRunSentence("monthly", nextMonthly, timeZone),
        // A run that was held back is not shown; the next one is a fact worth stating.
        firstCompetitive: firstRunSentence("competitive", nextCompetitive, timeZone, { first: !competitive.data }),
        actions: actionItems({
          clientId, isStaff, week, content,
          openTopics: topics.length,
          endorsedTests: fb.filter((r) => r.verdict === "up").length,
        }),
      };
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Loading label="Loading the overview" />;
  if (isError || !data) return null;
  const { report, headline, competitive, standing, content, actions, firstMonthly, firstCompetitive } = data;

  return (
    <div className="space-y-4">
      {/* Three tiles on the card's own inner surface. They were cards inside
          the client's card, glass on glass, and a tile with nothing to say
          was left blank. */}
      <div className="grid gap-inner md:grid-cols-3">
        {/* Performance: the last monthly report, three numbers and the direction. */}
        <section className="glass-inner p-inner flex flex-col gap-3 min-w-0">
            <p className="t-subhead flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" aria-hidden /> Performance</p>
            {headline && report ? (
              <>
                <p className="t-secondary">{formatRange({ start: report.date_range_start, end: report.date_range_end }) || "Last month"} vs. the month before</p>
                <div className="grid grid-cols-3 gap-2">
                  {headline.metrics.map((m) => (
                    <div key={m.key} className="min-w-0">
                      <p className="t-h2 tabular-nums">{compactNumber(m.current)}</p>
                      {m.percent != null && <p className={`t-label font-semibold ${m.percent > 0 ? "!text-success" : m.percent < 0 ? "!text-[#f87171]" : ""}`}>{formatPercentChange(m.percent)}</p>}
                      <p className="t-label truncate">{m.label}</p>
                    </div>
                  ))}
                </div>
                {headline.total > 0 && <p className="t-body">{headline.rose} of {headline.total} measures rose.</p>}
                <Link to={`/clients/${clientId}/reports/${report.id}`} className="t-link inline-flex items-center gap-1 mt-auto">Open the report <ArrowRight className="h-3 w-3" aria-hidden /></Link>
              </>
            ) : (
              <p className="t-secondary">{firstMonthly || "No monthly report yet."}</p>
            )}
        </section>

        {/* Competitors: share of voice, who, and where the client leads or trails. */}
        <section className="glass-inner p-inner flex flex-col gap-3 min-w-0">
            <p className="t-subhead flex items-center gap-1.5"><Crosshair className="h-3.5 w-3.5" aria-hidden /> Competitors</p>
            {standing && competitive ? (
              <>
                {standing.shareOfVoice != null && (
                  <div>
                    <p className="t-h2 tabular-nums">{standing.shareOfVoice}%</p>
                    <p className="t-label">share of the posts in the field</p>
                  </div>
                )}
                {standing.competitors.length > 0 && <p className="t-body">Compared with {andList(standing.competitors.map(displayCompanyName))}.</p>}
                {(standing.ahead.length > 0 || standing.behind.length > 0) && (
                  <p className="t-body">
                    {standing.ahead.length > 0 && <>Ahead on {andList(standing.ahead)}. </>}
                    {standing.behind.length > 0 && <>Behind on {andList(standing.behind)}.</>}
                  </p>
                )}
                <Link to={`/clients/${clientId}/competitive/reports/${competitive.id}`} className="t-link inline-flex items-center gap-1 mt-auto">Open the competitive report <ArrowRight className="h-3 w-3" aria-hidden /></Link>
              </>
            ) : (
              <p className="t-secondary">{firstCompetitive || "No competitive analysis yet."}</p>
            )}
        </section>

        {/* Content: this week of the calendar, Monday to Sunday. */}
        <section className="glass-inner p-inner flex flex-col gap-3 min-w-0">
            <p className="t-subhead flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> This week</p>
            {content.planned > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                <div><p className="t-h2 tabular-nums">{content.planned}</p><p className="t-label">planned</p></div>
                <div><p className="t-h2 tabular-nums">{content.designed}</p><p className="t-label">designed</p></div>
                <div><p className="t-h2 tabular-nums">{content.approved}</p><p className="t-label">approved</p></div>
              </div>
            ) : (
              <p className="t-secondary">No posts are planned for this week.</p>
            )}
            <Link to={`/clients/${clientId}/calendar`} className="t-link inline-flex items-center gap-1 mt-auto">Open the calendar <ArrowRight className="h-3 w-3" aria-hidden /></Link>
        </section>
      </div>

      {/* What needs doing, linked to where it is done. */}
      <section className="glass-inner p-inner space-y-2">
          <p className="t-subhead">Action items</p>
          {actions.length === 0 ? (
            <p className="t-secondary flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Nothing needs attention right now.</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {actions.map((a) => (
                <li key={a.key}>
                  <Link to={a.href} className="flex items-center gap-3 py-2.5 group">
                    {a.tone === "attention" ? <CircleAlert className="h-4 w-4 shrink-0 text-[#f5b942]" /> : <Info className="h-4 w-4 shrink-0 text-[#b1b7c1]" />}
                    <span className="t-body flex-1">{a.text}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 opacity-50 group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
