import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlatformIcon, getPlatformColor } from "@/lib/platform-config";
import { Hash, Lightbulb, Target, TrendingUp } from "lucide-react";

interface TrendData {
  overview?: string;
  top_themes?: string[];
  top_hashtags?: string[];
  key_takeaways?: string[];
  successful_formats?: string[];
  opportunities_for_client?: string[];
}

interface Props {
  reports: any[];
}

/** Aggregate trend data across multiple reports cumulatively */
function aggregateTrends(
  reports: any[],
  key: "tiktok_trends_analysis" | "instagram_trends_analysis",
): TrendData | null {
  const allThemes: string[] = [];
  const allHashtags: string[] = [];
  const allTakeaways: string[] = [];
  const allFormats: string[] = [];
  const allOpps: string[] = [];
  let latestOverview = "";

  for (const r of reports) {
    const rawRd = r.report_data;
    const rd = Array.isArray(rawRd) ? rawRd[0] : rawRd;
    const t = rd?.ai_analysis?.[key];
    if (!t) continue;
    if (t.overview) latestOverview = t.overview;
    if (Array.isArray(t.top_themes)) allThemes.push(...t.top_themes);
    if (Array.isArray(t.top_hashtags)) allHashtags.push(...t.top_hashtags);
    if (Array.isArray(t.key_takeaways)) allTakeaways.push(...t.key_takeaways);
    if (Array.isArray(t.successful_formats)) allFormats.push(...t.successful_formats);
    if (Array.isArray(t.opportunities_for_client)) allOpps.push(...t.opportunities_for_client);
  }

  if (!latestOverview && allThemes.length === 0) return null;

  // Deduplicate by keeping unique strings (case-insensitive)
  const dedup = (arr: string[]) => {
    const seen = new Set<string>();
    return arr.filter((s) => {
      const low = s.toLowerCase().trim();
      if (seen.has(low)) return false;
      seen.add(low);
      return true;
    });
  };

  return {
    overview: latestOverview,
    top_themes: dedup(allThemes).slice(0, 8),
    top_hashtags: dedup(allHashtags.map((h) => h.replace(/^#/, ""))).slice(0, 15),
    key_takeaways: dedup(allTakeaways).slice(0, 6),
    successful_formats: dedup(allFormats).slice(0, 6),
    opportunities_for_client: dedup(allOpps).slice(0, 6),
  };
}

function PlatformTrendCard({ platform, data }: { platform: "TikTok" | "Instagram"; data: TrendData }) {
  const platformKey = platform.toLowerCase();
  const color = getPlatformColor(platformKey);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PlatformIcon platform={platformKey} className="h-5 w-5" />
          <span style={{ color }}>{platform}</span> Trend Analysis
          <Badge variant="secondary" className="text-xs ml-auto">
            Cumulative
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Overview */}
        {data.overview && (
          <div>
            <p className="text-sm text-muted-foreground leading-relaxed">{data.overview}</p>
          </div>
        )}

        {/* Themes + Hashtags side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.top_themes && data.top_themes.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Top Themes
              </h4>
              <ul className="space-y-1.5">
                {data.top_themes.map((theme, i) => (
                  <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-2">
                    <span className="text-foreground font-medium shrink-0">{i + 1}.</span>
                    {theme}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.top_hashtags && data.top_hashtags.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5" /> Top Hashtags
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {data.top_hashtags.map((tag, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    #{tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Opportunities */}
        {data.opportunities_for_client && data.opportunities_for_client.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5" /> Opportunities
            </h4>
            <div className="space-y-2">
              {data.opportunities_for_client.map((opp, i) => (
                <div key={i} className="text-xs text-muted-foreground bg-[rgba(255,255,255,0.04)] p-2.5 rounded-md leading-relaxed">
                  {opp}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Key Takeaways */}
        {data.key_takeaways && data.key_takeaways.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5" /> Key Takeaways
            </h4>
            <div className="space-y-2">
              {data.key_takeaways.map((t, i) => (
                <div key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-2">
                  <span className="text-foreground font-medium shrink-0">•</span>
                  {t}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Successful Formats */}
        {data.successful_formats && data.successful_formats.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">What's Working</h4>
            <div className="flex flex-wrap gap-1.5">
              {data.successful_formats.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {f}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TrendInsightsSection({ reports }: Props) {
  const tiktokTrends = useMemo(() => aggregateTrends(reports, "tiktok_trends_analysis"), [reports]);
  const igTrends = useMemo(() => aggregateTrends(reports, "instagram_trends_analysis"), [reports]);

  if (!tiktokTrends && !igTrends) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Trend Analysis</h3>
      {tiktokTrends && <PlatformTrendCard platform="TikTok" data={tiktokTrends} />}
      {igTrends && <PlatformTrendCard platform="Instagram" data={igTrends} />}
    </div>
  );
}
