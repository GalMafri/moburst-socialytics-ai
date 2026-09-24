type Numeric = number | null | undefined;
type ProviderMetric = { current?: Numeric };
type ProviderNetwork = { posts?: ProviderMetric; rate?: ProviderMetric; engagement?: ProviderMetric; impressions?: ProviderMetric };
type Company = {
  is_client?: boolean; post_count?: number; observed_post_count?: number; engagement_total?: number; engagement_sum?: number; impressions_total?: number;
  cadence_per_week?: number; by_channel?: Record<string, { post_count?: number; cadence_per_week?: number }>;
  rivaliq_metrics?: { posts?: ProviderMetric; audience?: { current?: Numeric }; engagement?: { current?: Numeric }; estimated_impressions?: ProviderMetric; engagement_rate_per_post?: ProviderMetric; by_network?: Record<string, ProviderNetwork> };
};
export type Dimension = { dimension: string; unit: string; client: number; competitor_avg: number; competitor_count: number };

export function inclusiveDays(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(end.slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) + 1 : null;
}
const valid = (value: Numeric): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function factualDimensions(companies: Company[], days: number | null): Dimension[] {
  const client = companies.find((c) => c.is_client);
  if (!client) return [];
  const rivals = companies.filter((c) => !c.is_client);
  const definitions: Array<[string, string, (c: Company) => Numeric]> = [
    ["Audience", "followers", (c) => c.rivaliq_metrics?.audience?.current],
    ["Cadence", "posts/week", (c) => days && valid(c.post_count) ? c.post_count / days * 7 : c.cadence_per_week],
    ["Engagement", "engagements", (c) => c.rivaliq_metrics?.engagement?.current ?? c.engagement_sum ?? c.engagement_total],
    ["Estimated impressions", "impressions", (c) => c.rivaliq_metrics?.estimated_impressions?.current ?? c.impressions_total],
  ];
  return definitions.flatMap(([dimension, unit, metric]) => {
    const value = metric(client);
    const peers = rivals.map(metric).filter(valid);
    if (!valid(value) || !peers.length) return [];
    return [{ dimension, unit, client: value, competitor_avg: peers.reduce((a, b) => a + b, 0) / peers.length, competitor_count: peers.length }];
  });
}

export function comparisonScale(client: number, average: number) {
  const max = Math.max(1, client, average);
  return { client: client / max * 100, competitor: average / max * 100 };
}

/** Correct numeric views without rewriting stored historical reports or AI prose. */
type MetricReport = { period?: { start?: string; end?: string; days?: number }; aggregates?: { metric_semantics_version?: number; period?: { start?: string; end?: string; days?: number }; companies?: Company[] }; ai_analysis?: { benchmark_scorecard?: Record<string, unknown> } };
export function normalizedCompetitiveMetrics<T>(input: T): T & MetricReport {
  const report = (input && typeof input === "object" ? input : {}) as MetricReport;
  const period = report.period || report.aggregates?.period;
  const days = inclusiveDays(period?.start, period?.end);
  const providerValues = (posts: number | undefined, metrics?: ProviderNetwork) => ({
    ...(valid(metrics?.rate?.current) ? { engagement_rate_avg: metrics.rate.current } : {}),
    ...(posts && valid(metrics?.engagement?.current) ? { engagement_avg: metrics.engagement.current / posts } : {}),
    ...(valid(metrics?.impressions?.current) ? { impressions_total: metrics.impressions.current, impressions_avg: posts ? metrics.impressions.current / posts : 0 } : {}),
  });
  const authoritative = (report.aggregates?.metric_semantics_version || 0) >= 3;
  const normalizeBucket = (b: { post_count?: number; observed_post_count?: number }, metrics?: ProviderNetwork) => {
    const count = authoritative && valid(metrics?.posts?.current) ? metrics.posts.current : b.post_count;
    return {
      ...b,
      ...(authoritative ? { observed_post_count: b.observed_post_count ?? b.post_count ?? 0 } : {}),
      post_count: count,
      ...providerValues(count, metrics),
      ...(days ? { cadence_per_week: Math.round((count || 0) / days * 70) / 10 } : {}),
    };
  };
  const companies = (report.aggregates?.companies || []).map((c) => {
    const channels = { ...c.by_channel };
    if (authoritative) for (const network of Object.keys(c.rivaliq_metrics?.by_network || {})) {
      const key = network === 'twitter' && channels.x ? 'x' : network;
      channels[key] ??= { post_count: 0 };
    }
    return {
      ...c,
      ...normalizeBucket(c, { ...c.rivaliq_metrics, rate: c.rivaliq_metrics?.engagement_rate_per_post, impressions: c.rivaliq_metrics?.estimated_impressions }),
      by_channel: Object.fromEntries(Object.entries(channels).map(([key, b]) => [key,
        normalizeBucket(b, c.rivaliq_metrics?.by_network?.[key === 'x' ? 'twitter' : key]),
      ])),
    };
  });
  return {
    ...report,
    ...(days ? { period: { ...period, days } } : {}),
    aggregates: { ...report.aggregates, companies, ...(days && report.aggregates?.period ? { period: { ...report.aggregates.period, days } } : {}) },
    ai_analysis: { ...report.ai_analysis, benchmark_scorecard: {
      ...report.ai_analysis?.benchmark_scorecard,
      dimensions: factualDimensions(companies, days),
    } },
  } as T & MetricReport;
}
