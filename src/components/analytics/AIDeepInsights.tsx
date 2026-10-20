import { SPROUT_RATE_NOTE } from "@/lib/rateLabels";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { InsightGrid } from "@/components/ui/insight-card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Eye, Heart, Percent, ListChecks } from "lucide-react";
import { reportCounts } from "@/lib/reportFigures";
import { engagementRate } from "@/lib/competitiveMetrics";

interface Props {
  reports: any[];
  chartData: {
    date: string;
    impressions: number;
    reactions: number;
    link_clicks: number;
    video_views: number;
    engagements: number;
    engagement_rate: number;
  }[];
}

export function AIDeepInsights({ reports, chartData }: Props) {
  const insights = useMemo(() => {
    const result: { text: string; type: "up" | "down" | "neutral"; icon?: string }[] = [];
    if (chartData.length === 0) return result;

    // Performance trajectory
    if (chartData.length >= 2) {
      const first = chartData[0];
      const last = chartData[chartData.length - 1];

      // Impressions trend (require minimum threshold to avoid misleading percentages)
      if (first.impressions >= 10 && last.impressions > 0) {
        const pct = Math.round(((last.impressions - first.impressions) / first.impressions) * 100);
        if (pct > 0) {
          result.push({
            text: `Impressions grew ${pct}% across reports (${first.impressions.toLocaleString()} → ${last.impressions.toLocaleString()})`,
            type: "up",
          });
        } else if (pct < 0) {
          result.push({
            text: `Impressions declined ${Math.abs(pct)}% across reports (${first.impressions.toLocaleString()} → ${last.impressions.toLocaleString()})`,
            type: "down",
          });
        }
      }

      // Engagement trend
      if (first.engagements >= 5 && last.engagements > 0) {
        const pct = Math.round(((last.engagements - first.engagements) / first.engagements) * 100);
        if (pct > 0) {
          result.push({ text: `Total engagements grew ${pct}% over this period`, type: "up" });
        } else if (pct < 0) {
          result.push({ text: `Total engagements dropped ${Math.abs(pct)}% over this period`, type: "down" });
        }
      }

      // Engagement rate
      if (last.engagement_rate > first.engagement_rate) {
        result.push({
          text: `Sprout engagement rate improved from ${first.engagement_rate.toFixed(2)}% to ${last.engagement_rate.toFixed(2)}%`,
          type: "up",
        });
      } else if (last.engagement_rate < first.engagement_rate && first.engagement_rate > 0) {
        result.push({
          text: `Sprout engagement rate decreased from ${first.engagement_rate.toFixed(2)}% to ${last.engagement_rate.toFixed(2)}%`,
          type: "down",
        });
      }
    }

    // Peak performance
    const bestImpr = chartData.reduce((best, d) => (d.impressions > best.impressions ? d : best));
    if (bestImpr.impressions > 0) {
      result.push({
        text: `Peak impressions: ${bestImpr.impressions.toLocaleString()} on ${bestImpr.date}`,
        type: "neutral",
      });
    }

    const bestEng = chartData.reduce((best, d) => (d.engagements > best.engagements ? d : best));
    if (bestEng.engagements > 0) {
      result.push({
        text: `Peak engagement: ${bestEng.engagements.toLocaleString()} on ${bestEng.date}`,
        type: "neutral",
      });
    }

    // Cumulative totals
    const totalImpr = chartData.reduce((s, d) => s + d.impressions, 0);
    const totalEng = chartData.reduce((s, d) => s + d.engagements, 0);
    // The one definition: engagements divided by impressions.
    const avgEngRate = (engagementRate(totalEng, totalImpr) ?? 0) * 100;
    if (avgEngRate > 0) {
      result.push({ text: `Average Sprout engagement rate across all reports: ${avgEngRate.toFixed(2)}%`, type: "neutral" });
    }

    // What the reports produced, counted as the report page counts it.
    let totalRecs = 0;
    for (const r of reports) totalRecs += reportCounts(r.report_data).recommendations;
    if (totalRecs > 0) {
      result.push({ text: `${totalRecs} recommendations across ${reports.length} reports`, type: "neutral" });
    }

    // Trend coverage
    let tiktokReports = 0;
    let igReports = 0;
    for (const r of reports) {
      const rawRd2 = r.report_data;
      const rd2 = Array.isArray(rawRd2) ? rawRd2[0] : rawRd2;
      if (rd2?.ai_analysis?.tiktok_trends_analysis) tiktokReports++;
      if (rd2?.ai_analysis?.instagram_trends_analysis) igReports++;
    }
    if (tiktokReports > 0 || igReports > 0) {
      const parts = [];
      if (tiktokReports > 0) parts.push(`TikTok (${tiktokReports})`);
      if (igReports > 0) parts.push(`Instagram (${igReports})`);
      result.push({ text: `Trend analysis available for: ${parts.join(", ")} reports`, type: "neutral" });
    }

    return result;
  }, [reports, chartData]);

  // Facts as tiles, movements as cards, coverage as chips. Nothing here is AI-written: it is
  // computed from the reports in the window, so it is labelled that way.
  const facts = useMemo(() => {
    if (chartData.length === 0) return null;
    const bestImpr = chartData.reduce((b, d) => (d.impressions > b.impressions ? d : b));
    const bestEng = chartData.reduce((b, d) => (d.engagements > b.engagements ? d : b));
    const totalImpr = chartData.reduce((t, d) => t + d.impressions, 0);
    const totalEng = chartData.reduce((t, d) => t + d.engagements, 0);
    let recs = 0, tiktok = 0, ig = 0;
    for (const r of reports) {
      const rd = Array.isArray(r.report_data) ? r.report_data[0] : r.report_data;
      // Recommendations means the actions a report recommends, as on the report page.
      recs += reportCounts(rd).recommendations;
      if (rd?.ai_analysis?.tiktok_trends_analysis) tiktok++;
      if (rd?.ai_analysis?.instagram_trends_analysis) ig++;
    }
    return { bestImpr, bestEng, avgRate: (engagementRate(totalEng, totalImpr) ?? 0) * 100, recs, tiktok, ig };
  }, [reports, chartData]);
  const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `${(v / 1_000).toFixed(1)}K` : v.toLocaleString());
  const trends = insights.filter((x) => x.type !== "neutral").map((x) => x.text);
  if (!facts) return null;
  const n = reports.length;
  return (
    <Section
      title="Across the reports in this window"
      description={`Computed from ${n} ${n === 1 ? "report" : "reports"}: peaks, the average Sprout engagement rate, and how much the reports produced.`}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Peak impressions" icon={<Eye className="h-3.5 w-3.5" />} value={compact(facts.bestImpr.impressions)} sub={`on ${facts.bestImpr.date}`} />
        <StatCard label="Peak engagement" icon={<Heart className="h-3.5 w-3.5" />} value={compact(facts.bestEng.engagements)} sub={`on ${facts.bestEng.date}`} />
        <StatCard label="Avg Sprout engagement rate" icon={<Percent className="h-3.5 w-3.5" />} value={`${facts.avgRate.toFixed(2)}%`} sub={SPROUT_RATE_NOTE} />
        <StatCard label="Recommendations" icon={<ListChecks className="h-3.5 w-3.5" />} value={facts.recs} sub={`across ${n} ${n === 1 ? "report" : "reports"}`} />
      </div>
      {(trends.length > 0 || facts.tiktok > 0 || facts.ig > 0) && (
        <Card>
          <CardContent className="pt-5 space-y-4">
            {trends.length > 0 && <InsightGrid items={trends} numbered={false} />}
            {(facts.tiktok > 0 || facts.ig > 0) && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="t-subhead">Trend analysis in</span>
                {facts.tiktok > 0 && <Badge variant="outline">TikTok · {facts.tiktok} {facts.tiktok === 1 ? "report" : "reports"}</Badge>}
                {facts.ig > 0 && <Badge variant="outline">Instagram · {facts.ig} {facts.ig === 1 ? "report" : "reports"}</Badge>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </Section>
  );
}
