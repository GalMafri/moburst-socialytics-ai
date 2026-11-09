import { Lightbulb, Target } from "lucide-react";
import { Section } from "@/components/ui/section";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/ui/loading";
import { Prose } from "@/components/ui/prose";
import { InsightGrid } from "@/components/ui/insight-card";
import { ThemeWeeks, useThemePlatformFilter } from "@/components/trends/TrendThemes";
import { useAuth } from "@/hooks/useAuth";
import type { TrendTheme } from "@/hooks/useTrendThemes";
import { platformKey, platformName } from "@/lib/display";
import { industryTrendsAnalysis } from "@/lib/reportFigures";

const NO_THEMES: TrendTheme[] = [];

/**
 * A monthly report's trends once the weekly Trends collection has stored
 * themes for its period (reportTrends in src/lib/reportFigures.ts): one
 * Industry trends section in place of the report's own TikTok and Instagram
 * ones, whichever engine wrote the report. The themes come as Analytics shows
 * them, by week with their platforms and example posts, minus the Dismiss:
 * a report is a record of its month, and themes are dismissed on Analytics
 * or Client setup. The report's own industry analysis shows above and below
 * the themes when it has one (Trends Task 16).
 *
 * `themes` null: none could be read; the analysis alone shows. `loading`:
 * they are still being read.
 */
export function IndustryTrendsSection({ themes, loading, aiAnalysis, clientName }: { themes: TrendTheme[] | null; loading: boolean; aiAnalysis: unknown; clientName: string }) {
  const { isMoburstStaff } = useAuth();
  const { filter, shown } = useThemePlatformFilter(themes ?? NO_THEMES);
  const analysis = industryTrendsAnalysis(aiAnalysis);
  const withPosts = loading || shown.length > 0;

  return (
    <>
      <Section
        id="industry-trends"
        title="Industry trends"
        description={withPosts ? "Each week's industry themes in this period, with the example posts behind them." : "This period's industry themes."}
        action={filter || undefined}
      >
        {analysis && (analysis.overview || analysis.themes.length > 0) && (
          <Card>
            <CardContent className="pt-5 space-y-5">
              {analysis.overview && <Prose text={analysis.overview} />}
              {analysis.themes.length > 0 && (
                <div className={analysis.overview ? "pt-4 border-t border-white/[0.06] space-y-3" : "space-y-3"}>
                  <p className="t-subhead">What the themes mean for {clientName}</p>
                  <ul className="space-y-3">
                    {analysis.themes.map((t, i) => (
                      <li key={`${t.title}-${i}`} className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {t.title && <span className="t-h4">{t.title}</span>}
                          {[...new Set(t.platforms.map(platformKey).filter(Boolean))].map((p) => <Badge key={p} variant="outline">{platformName(p)}</Badge>)}
                        </div>
                        {t.note && <p className="t-secondary">{t.note}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {loading ? <Loading label="Loading trends" /> : <ThemeWeeks themes={shown} staff={isMoburstStaff} />}
      </Section>

      {analysis && analysis.opportunities.length > 0 && (
        <Section id="industry-opportunities" title={<><Target className="h-5 w-5 text-primary" aria-hidden /> Opportunities for {clientName}</>} description="Where this period's trends meet the brand's strengths.">
          <InsightGrid items={analysis.opportunities} numbered={true} />
        </Section>
      )}

      {analysis && analysis.takeaways.length > 0 && (
        <Section id="industry-takeaways" title={<><Lightbulb className="h-5 w-5 text-warning" aria-hidden /> Key takeaways</>}>
          <InsightGrid items={analysis.takeaways} numbered={false} />
        </Section>
      )}
    </>
  );
}
