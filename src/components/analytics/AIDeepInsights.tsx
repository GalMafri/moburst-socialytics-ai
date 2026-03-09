import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, TrendingUp, TrendingDown, BarChart3, Calendar, FileText } from "lucide-react";

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
          text: `Engagement rate improved from ${first.engagement_rate.toFixed(2)}% to ${last.engagement_rate.toFixed(2)}%`,
          type: "up",
        });
      } else if (last.engagement_rate < first.engagement_rate && first.engagement_rate > 0) {
        result.push({
          text: `Engagement rate decreased from ${first.engagement_rate.toFixed(2)}% to ${last.engagement_rate.toFixed(2)}%`,
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
    const avgEngRate = totalImpr > 0 ? (totalEng / totalImpr) * 100 : 0;
    if (avgEngRate > 0) {
      result.push({ text: `Average engagement rate across all reports: ${avgEngRate.toFixed(2)}%`, type: "neutral" });
    }

    // Content calendar coverage
    let totalCalendarDays = 0;
    let totalRecs = 0;
    for (const r of reports) {
      const dc = r.report_data?.data_counts;
      if (dc) {
        totalCalendarDays += dc.content_calendar_days || 0;
        totalRecs += dc.total_recommendations || 0;
      }
    }
    if (totalCalendarDays > 0) {
      result.push({
        text: `${totalCalendarDays} content calendar days and ${totalRecs} recommendations generated across ${reports.length} reports`,
        type: "neutral",
      });
    }

    // Trend coverage
    let tiktokReports = 0;
    let igReports = 0;
    for (const r of reports) {
      if (r.report_data?.ai_analysis?.tiktok_trends_analysis) tiktokReports++;
      if (r.report_data?.ai_analysis?.instagram_trends_analysis) igReports++;
    }
    if (tiktokReports > 0 || igReports > 0) {
      const parts = [];
      if (tiktokReports > 0) parts.push(`TikTok (${tiktokReports})`);
      if (igReports > 0) parts.push(`Instagram (${igReports})`);
      result.push({ text: `Trend analysis available for: ${parts.join(", ")} reports`, type: "neutral" });
    }

    return result;
  }, [reports, chartData]);

  if (insights.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4" /> AI-Powered Insights
          <Badge variant="secondary" className="text-xs ml-auto">
            Cumulative Analysis
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {insights.map((ins, i) => (
            <div key={i} className="flex items-start gap-3 text-sm">
              {ins.type === "up" ? (
                <TrendingUp className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "hsl(142 76% 36%)" }} />
              ) : ins.type === "down" ? (
                <TrendingDown className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              ) : (
                <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <span>{ins.text}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
