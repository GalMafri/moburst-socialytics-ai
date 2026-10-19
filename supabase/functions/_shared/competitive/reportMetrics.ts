type Numeric = number | null | undefined;
type ProviderMetric = { current?: Numeric; previous?: Numeric };
type ProviderNetwork = { posts?: ProviderMetric; engagement_rate?: ProviderMetric; engagement?: ProviderMetric; impressions?: ProviderMetric; views?: ProviderMetric };
type Company = {
  owned_metrics?: any;
  rivaliq_audience_snapshot?: { as_of: string; audience: number; by_network?: Record<string, number> };
  linkedin_metrics?: { provider: string; period: {start: string; end: string}; posts: number; engagement: number; coverage: string };
  comparison_metrics?: any;
  is_client?: boolean; post_count?: number; observed_post_count?: number; engagement_total?: number; engagement_sum?: number; impressions_total?: Numeric;
  cadence_per_week?: number; by_channel?: Record<string, { post_count?: number; cadence_per_week?: number; top_posts?: any[] }>;
  top_posts?: any[];
  rivaliq_metrics?: { posts?: ProviderMetric; audience?: { current?: Numeric }; engagement?: ProviderMetric; estimated_impressions?: ProviderMetric; by_network?: Record<string, ProviderNetwork> };
};
export type Dimension = { dimension: string; unit: string; client: number; competitor_avg: number; competitor_count: number };

export function inclusiveDays(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(end.slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) + 1 : null;
}
const valid = (value: Numeric): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * The one engagement rate in the product (Lital, 19 Oct 2026): engagements
 * divided by impressions, with views counted as the impressions of video
 * networks. Every screen, the public API, the report narrative and the n8n
 * workflow use this function. It is null when either figure is missing or
 * there were no impressions, so a screen shows nothing there instead of a
 * rate worked out some other way.
 */
export function engagementRate(engagements: Numeric, impressions: Numeric): number | null {
  return valid(engagements) && valid(impressions) && impressions > 0 ? engagements / impressions : null;
}

/** Networks whose reach is counted in views. */
export function isVideoNetwork(network: unknown): boolean {
  const n = String(network ?? "").toLowerCase();
  return n.includes("tiktok") || n.includes("youtube");
}

/** Which figure a rate was divided by: views, measured impressions, or estimated impressions. */
export type ReachKind = "views" | "impressions" | "estimated";

/**
 * The reach figure of one post: views on video networks, otherwise the
 * measured impressions of the client's own post, otherwise the estimated
 * impressions, otherwise views. Null when the post carries none of them.
 */
export function postReach(post: { channel?: unknown; views?: Numeric; actual_impressions?: Numeric; est_impressions?: Numeric } | null | undefined): { value: number; kind: ReachKind } | null {
  if (!post) return null;
  const positive = (n: Numeric): n is number => valid(n) && n > 0;
  if (isVideoNetwork(post.channel) && positive(post.views)) return { value: post.views, kind: "views" };
  if (positive(post.actual_impressions)) return { value: post.actual_impressions, kind: "impressions" };
  if (positive(post.est_impressions)) return { value: post.est_impressions, kind: "estimated" };
  if (positive(post.views)) return { value: post.views, kind: "views" };
  return null;
}

/** One post's engagement rate: per impression, or per view on video, when the post has either; otherwise none. */
export function postEngagementRate(post: { engagement?: Numeric; channel?: unknown; views?: Numeric; actual_impressions?: Numeric; est_impressions?: Numeric } | null | undefined): number | null {
  return engagementRate(post?.engagement, postReach(post)?.value);
}

/** A network's impressions for the rate: its views on video networks when reported, else its impressions. */
function networkImpressions(network: string, n: ProviderNetwork | undefined, which: "current" | "previous"): Numeric {
  const views = n?.views?.[which];
  return isVideoNetwork(network) && valid(views) ? views : n?.impressions?.[which];
}

const rateOf = (engagement: ProviderMetric | undefined, impressions: (which: "current" | "previous") => Numeric, posts?: ProviderMetric) => ({
  current: posts?.current === 0 ? null : engagementRate(engagement?.current, impressions("current")),
  previous: posts?.previous === 0 ? null : engagementRate(engagement?.previous, impressions("previous")),
});

/**
 * Every company's rates come from RivalIQ's stored period totals, the client
 * included: engagement over estimated impressions across the networks it
 * tracks, and per network the same with views on video networks. RivalIQ
 * does not track LinkedIn, so LinkedIn has no rate. Sprout's figures for the
 * client never replace these: the comparison is one source for every company.
 */
function rivalIqRates(r: { posts?: ProviderMetric; engagement?: ProviderMetric; estimated_impressions?: ProviderMetric; by_network?: Record<string, ProviderNetwork> }) {
  return {
    engagement_rate: rateOf(r.engagement, (which) => r.estimated_impressions?.[which], r.posts),
    by_network: Object.fromEntries(Object.entries(r.by_network || {}).map(([network, n]) => [network,
      rateOf(n.engagement, (which) => networkImpressions(network, n, which), n.posts)])) as Record<string, { current: number | null; previous: number | null }>,
  };
}

/** The comparison metrics with the one rate definition, and no other rate left in them to read. */
function withRates(metrics: any, rates: ReturnType<typeof rivalIqRates>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { engagement_rate_per_post: _perPost, ...rest } = metrics;
  return {
    ...rest,
    engagement_rate: rates.engagement_rate,
    metric_scopes: { ...rest.metric_scopes, engagement_rate: "rivaliq" },
    by_network: Object.fromEntries(Object.entries(rest.by_network || {}).map(([network, value]: [string, any]) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rate: _rate, ...n } = value || {};
      return [network, { ...n, engagement_rate: rates.by_network[network] ?? { current: null, previous: null } }];
    })),
  };
}

/**
 * A company's comparison figures, the same sources for every company, the
 * client included (self-serve design, 19 Oct 2026): RivalIQ's period totals,
 * plus the public LinkedIn source where it was collected. The client's own
 * Sprout figures (owned_metrics) never enter a comparison; they belong to the
 * client's own performance screens. Adding LinkedIn activity must not erase
 * RivalIQ audience, impressions or engagement rates.
 */
export function competitiveCompanyMetrics(c: {rivaliq_metrics?: any; linkedin_metrics?: any; rivaliq_audience_snapshot?: any}): any {
  const r = c.rivaliq_metrics;
  const li = c.linkedin_metrics;
  if (!r) return r;
  const rates = rivalIqRates(r);
  const snapshot = c.rivaliq_audience_snapshot;
  const useSnapshot = !valid(r.audience?.current) && valid(snapshot?.audience) && /^\d{4}-\d{2}-\d{2}$/.test(snapshot?.as_of || '');
  const base = {
    ...r,
    audience: useSnapshot ? {current:snapshot.audience,previous:null} : r.audience,
    audience_as_of: useSnapshot ? snapshot.as_of : undefined,
    metric_scopes: {audience:'rivaliq',estimated_impressions:'rivaliq'},
    impression_post_count: r.posts?.current,
    by_network: Object.fromEntries(Object.entries(r.by_network || {}).map(([network, value]: [string, any]) => [network,
      useSnapshot && !valid(value.followers?.current) && valid(snapshot.by_network?.[network])
        ? {...value,followers:{current:snapshot.by_network[network],previous:null},audience_as_of:snapshot.as_of} : value,
    ])),
  };
  if (!li || li.coverage !== 'complete') return withRates(base, rates);
  const add = (value: Numeric, extra: Numeric) => valid(value) && valid(extra) ? value + extra : null;
  const unknown = { current: null, previous: null };
  const previous = li.previous?.coverage === 'complete' && r.previous_period
    && li.previous.period?.start === r.previous_period.start && li.previous.period?.end === r.previous_period.end ? li.previous : null;
  return withRates({
    ...base,
    posts: { current: add(r.posts?.current, li.posts), previous: previous ? add(r.posts?.previous, previous.posts) : null },
    engagement: { current: add(r.engagement?.current, li.engagement), previous: previous ? add(r.engagement?.previous, previous.engagement) : null },
    by_network: { ...base.by_network, linkedin: {
      posts: {current:li.posts,previous:previous?.posts ?? null}, engagement:{current:li.engagement,previous:previous?.engagement ?? null},
      followers:valid(li.audience_snapshot?.followers) ? {current:li.audience_snapshot.followers,previous:null} : unknown,
      audience_as_of:li.audience_snapshot?.as_of,
      impressions:unknown, rate:unknown,
      source:li.provider,
    } },
  }, rates);
}

export function factualDimensions(companies: Company[], days: number | null): Dimension[] {
  const client = companies.find((c) => c.is_client);
  if (!client) return [];
  const rivals = companies.filter((c) => !c.is_client);
  const definitions: Array<[string, string, (c: Company) => Numeric]> = [
    ["Audience", "followers", (c) => competitiveCompanyMetrics(c)?.audience?.current],
    ["Cadence", "posts/week", (c) => days && valid(c.post_count) ? c.post_count / days * 7 : c.cadence_per_week],
    ["Engagement", "engagements", (c) => competitiveCompanyMetrics(c)?.engagement?.current ?? c.engagement_sum ?? c.engagement_total],
    ["Estimated impressions", "impressions", (c) => competitiveCompanyMetrics(c)?.estimated_impressions?.current ?? c.impressions_total],
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
  // The rate is always set: from RivalIQ's totals through engagementRate(), or
  // null. A rate stored by an older workflow (per follower, averaged per post)
  // never passes through to a screen.
  const providerValues = (posts: number | undefined, metrics?: ProviderNetwork & {impression_post_count?: Numeric}) => ({
    engagement_rate_avg: valid(metrics?.engagement_rate?.current) ? metrics.engagement_rate.current : null,
    ...(posts && valid(metrics?.engagement?.current) ? { engagement_avg: metrics.engagement.current / posts } : {}),
    ...(metrics?.impressions ? { impressions_total: metrics.impressions.current ?? null, impressions_avg: valid(metrics.impressions.current) && (metrics.impression_post_count ?? posts) ? metrics.impressions.current / (metrics.impression_post_count ?? posts)! : null } : {}),
  });
  const authoritative = (report.aggregates?.metric_semantics_version || 0) >= 3;
  const normalizeBucket = (b: { post_count?: number; observed_post_count?: number; top_posts?: any[] }, metrics?: ProviderNetwork) => {
    const count = authoritative && valid(metrics?.posts?.current) ? metrics.posts.current : b.post_count;
    return {
      ...b,
      ...(authoritative ? { observed_post_count: b.observed_post_count ?? b.post_count ?? 0 } : {}),
      post_count: count,
      ...providerValues(count, metrics),
      ...(days ? { cadence_per_week: Math.round((count || 0) / days * 70) / 10 } : {}),
      // Ranked by total engagement as stored; each post's rate is per impression or view, or none.
      ...(Array.isArray(b.top_posts) ? { top_posts: b.top_posts.map((p) => ({ ...p, engagement_rate: postEngagementRate(p) })) } : {}),
    };
  };
  const companies = (report.aggregates?.companies || []).map((c) => {
    const metrics = competitiveCompanyMetrics(c);
    const channels: NonNullable<Company["by_channel"]> = { ...c.by_channel };
    if (authoritative && metrics) {
      for (const network of Object.keys(metrics.by_network || {})) {
        const key = network === 'twitter' && channels.x ? 'x' : network;
        channels[key] ??= { post_count: 0 };
      }
      // A platform the comparison sources have no figures for shows nothing,
      // for the client as for its peers: the client's own posts there (from
      // Sprout) are its own performance, never a comparison.
      for (const key of Object.keys(channels)) if (!metrics.by_network?.[key === 'x' ? 'twitter' : key]) delete channels[key];
    }
    return {
      ...c,
      ...normalizeBucket(c, { ...metrics, impressions: metrics?.estimated_impressions }),
      // After the bucket, which spreads the stored company again: the metrics
      // recomputed now replace the ones stored when the report was written.
      comparison_metrics: metrics,
      by_channel: Object.fromEntries(Object.entries(channels).map(([key, b]) => [key,
        normalizeBucket(b, metrics?.by_network?.[key === 'x' ? 'twitter' : key]),
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
