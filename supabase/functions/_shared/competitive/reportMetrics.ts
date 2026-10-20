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

/**
 * Whether a network shows a post's shares to anyone. Instagram and YouTube
 * keep shares private to the account, so no competitor source can count
 * them; counting the client's would compare different actions.
 */
export function sharesArePublic(network: unknown): boolean {
  const n = String(network ?? "").toLowerCase();
  return !n.includes("instagram") && !n.includes("youtube");
}

/**
 * The one count of engagements in the product (Lital, 20 Oct 2026): the
 * actions anyone can count on any company's post, so the client (from
 * Sprout) and its competitors (from RivalIQ and the public LinkedIn source)
 * are counted the same way. Reactions or likes, comments, and shares where
 * the network shows them (not Instagram or YouTube). Clicks, saves, story
 * replies and video views are not engagements: they are private to the
 * account, and no competitor has them. A part that is missing counts as
 * none observed; with all three missing there is no count.
 */
export function engagementsOf(network: unknown, parts: { applause?: Numeric; conversation?: Numeric; amplification?: Numeric }): number | null {
  const values = [parts.applause, parts.conversation, sharesArePublic(network) ? parts.amplification : null];
  if (!values.some(valid)) return null;
  return values.reduce<number>((sum, v) => sum + (valid(v) ? v : 0), 0);
}

/**
 * Ads are not posts. Sprout's post types name every ad (FACEBOOK_AD,
 * TIKTOK_AD, FB_INSTAGRAM_AD_POST, and the comments on them), and its ad rows
 * carry a guid starting "fa:". On Bader Law in September 2026 all 29 stored
 * "fa:" rows had no impressions and no engagement: copies of one caption
 * seconds apart. Counting them inflated post counts, share of voice and
 * cadence; without them the client's 13 Facebook posts equal RivalIQ's 13.
 * Stories, messages, comments, replies and dark posts are not posts either.
 */
export function isPublishedPost(row: { post_type?: unknown; guid?: unknown }): boolean {
  const type = String(row?.post_type || '').toUpperCase();
  if (/(^|_)ADS?(_|$)/.test(type)) return false;
  if (/STORY|DIRECT_MESSAGE|MESSENGER|COMMENT|REPLY|DARK|MENTION|RATING|PHOTO_TAG|FOLLOWER_ALERT/.test(type)) return false;
  if (/^fa:/i.test(String(row?.guid || ''))) return false;
  return true;
}

/**
 * The same rule for a post as a report stores it: a Sprout post keeps its
 * guid in its id ("sprout:<guid>"); posts from other sources are posts.
 */
export function isPublishedReportPost(post: { source?: unknown; postId?: unknown; post_type?: unknown } | null | undefined): boolean {
  if (!post) return false;
  const id = String(post.postId || '');
  if (post.source !== 'sprout' && !id.startsWith('sprout:')) return true;
  return isPublishedPost({ post_type: post.post_type, guid: id.replace(/^sprout:/, '') });
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
 * The networks a company's cross-network engagement rate covers: every
 * network with posts, an engagement count and an impressions (or views)
 * figure, except LinkedIn. No competitor source has LinkedIn impressions,
 * so the cross-network comparison leaves LinkedIn out for every company;
 * LinkedIn keeps its own per-platform rate where one is measured.
 */
function rateNetworks(by_network: Record<string, any>, which: "current" | "previous"): string[] {
  return Object.entries(by_network || {})
    .filter(([network, n]) => network !== 'linkedin' && n?.posts?.[which] !== 0 && valid(n?.engagement?.[which]) && valid(networkImpressions(network, n, which)))
    .map(([network]) => network);
}

/**
 * A company's rates, one definition for every company and every source
 * (Lital, 19 and 20 Oct 2026): engagements divided by impressions, views on
 * video networks. Per network from that network's own figures; across
 * networks, the engagements of the networks above over their impressions.
 * Figures that are all RivalIQ's (every competitor, and a client without
 * Sprout profiles) use RivalIQ's cross-channel totals, which are the sums of
 * its network totals (true of all 140 companies stored on 20 Oct 2026); the
 * client's networks that Sprout measures carry Sprout's figures and are
 * added up here.
 */
function companyRates(metrics: any, totals: any) {
  const by_network: Record<string, any> = metrics.by_network || {};
  const sum = (networks: string[], pick: (network: string, n: any) => Numeric) =>
    networks.reduce((total, network) => total + (pick(network, by_network[network]) as number), 0);
  // The previous period is rated over the same networks as this one, or not at all:
  // a rate that drops a network (one without a figure then) is not comparable.
  const across = (which: "current" | "previous", same?: string[]) => {
    const networks = same ?? rateNetworks(by_network, which);
    const measured = networks.some((network) => by_network[network]?.source === 'sprout');
    const totalsApply = !networks.length || (!measured && valid(totals?.engagement?.[which]));
    if (!totalsApply && same && !same.every((network) => valid(by_network[network]?.engagement?.[which]) && valid(networkImpressions(network, by_network[network], which)))) {
      return { networks, impressions: null, posts: null, rate: null };
    }
    if (totalsApply) {
      return {
        networks,
        impressions: valid(totals?.estimated_impressions?.[which]) ? totals.estimated_impressions[which] : null,
        posts: totals?.posts?.[which],
        rate: totals?.posts?.[which] === 0 ? null : engagementRate(totals?.engagement?.[which], totals?.estimated_impressions?.[which]),
      };
    }
    const impressions = sum(networks, (network, n) => networkImpressions(network, n, which));
    const posts = networks.every((network) => valid(by_network[network]?.posts?.[which])) ? sum(networks, (_, n) => n.posts[which]) : null;
    return {
      networks,
      impressions,
      posts,
      rate: posts === 0 ? null : engagementRate(sum(networks, (_, n) => n.engagement[which]), impressions),
    };
  };
  const current = across("current");
  const previous = across("previous", current.networks.length ? current.networks : undefined);
  return {
    engagement_rate: { current: current.rate, previous: previous.rate },
    engagement_rate_networks: current.networks,
    impressions: { current: current.impressions, previous: previous.impressions },
    impression_post_count: current.posts,
    by_network: Object.fromEntries(Object.entries(by_network).map(([network, n]) => [network,
      rateOf(n?.engagement, (which) => networkImpressions(network, n, which), n?.posts)])) as Record<string, { current: number | null; previous: number | null }>,
  };
}

/** Which source a company's figures come from: Sprout, RivalIQ, or both (a client platform Sprout does not cover). */
function sourceOf(by_network: Record<string, any>, networks: string[]): string {
  const sources = new Set(networks.map((network) => by_network[network]?.source === 'sprout' ? 'sprout' : 'rivaliq'));
  return sources.size > 1 ? 'sprout_and_rivaliq' : sources.values().next().value || 'rivaliq';
}

/** The comparison metrics with the one rate definition, and no other rate left in them to read. */
function withRates(metrics: any, rivaliqTotals: any) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { engagement_rate_per_post: _perPost, ...rest } = metrics;
  const rates = companyRates(rest, rivaliqTotals);
  return {
    ...rest,
    engagement_rate: rates.engagement_rate,
    engagement_rate_networks: rates.engagement_rate_networks,
    impressions: rates.impressions,
    impression_post_count: rates.impression_post_count,
    metric_scopes: { ...rest.metric_scopes, engagement_rate: sourceOf(rest.by_network || {}, rates.engagement_rate_networks), impressions: sourceOf(rest.by_network || {}, rates.engagement_rate_networks) },
    by_network: Object.fromEntries(Object.entries(rest.by_network || {}).map(([network, value]: [string, any]) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rate: _rate, ...n } = value || {};
      return [network, { ...n, engagement_rate: rates.by_network[network] ?? { current: null, previous: null } }];
    })),
  };
}

/**
 * A company's comparison figures. Competitors: RivalIQ's period totals, plus
 * the public LinkedIn source where it was collected, their only sources.
 * The client (Lital, 20 Oct 2026, "use the most accurate measurement, the
 * team typically works with sprout for their clients"): on every platform
 * where it has a Sprout profile, Sprout's measured figures for its published
 * posts (owned_metrics, ads left out); a platform Sprout does not cover keeps
 * RivalIQ's figures, that platform only. Adding LinkedIn activity must not
 * erase RivalIQ audience, impressions or engagement rates.
 */
export function competitiveCompanyMetrics(c: {rivaliq_metrics?: any; linkedin_metrics?: any; rivaliq_audience_snapshot?: any; owned_metrics?: any}): any {
  const r = c.rivaliq_metrics;
  const li = c.linkedin_metrics;
  if (!r) return r;
  const snapshot = c.rivaliq_audience_snapshot;
  const useSnapshot = !valid(r.audience?.current) && valid(snapshot?.audience) && /^\d{4}-\d{2}-\d{2}$/.test(snapshot?.as_of || '');
  const base = {
    ...r,
    audience: useSnapshot ? {current:snapshot.audience,previous:null} : r.audience,
    audience_as_of: useSnapshot ? snapshot.as_of : undefined,
    metric_scopes: {audience:'rivaliq',estimated_impressions:'rivaliq'},
    by_network: Object.fromEntries(Object.entries(r.by_network || {}).map(([network, value]: [string, any]) => [network,
      useSnapshot && !valid(value.followers?.current) && valid(snapshot.by_network?.[network])
        ? {...value,followers:{current:snapshot.by_network[network],previous:null},audience_as_of:snapshot.as_of} : value,
    ])),
  };
  if (!li || li.coverage !== 'complete') return withRates(applyOwnedMetrics(base, c.owned_metrics), r);
  const add = (value: Numeric, extra: Numeric) => valid(value) && valid(extra) ? value + extra : null;
  const unknown = { current: null, previous: null };
  const previous = li.previous?.coverage === 'complete' && r.previous_period
    && li.previous.period?.start === r.previous_period.start && li.previous.period?.end === r.previous_period.end ? li.previous : null;
  return withRates(applyOwnedMetrics({
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
  }, c.owned_metrics), r);
}

/**
 * The client's Sprout figures in place of RivalIQ's, platform by platform.
 * Every figure of a platform comes from one source: a platform whose Sprout
 * figures have no impressions has no rate, never a rate over another
 * source's impressions. Totals add up the platforms; the cross-network
 * audience leaves LinkedIn out, as it does for every company.
 */
function applyOwnedMetrics(base: any, owned: any) {
  if (owned?.coverage !== 'complete') return base;
  if (owned.period?.start !== base.period?.start || owned.period?.end !== base.period?.end) throw new Error('Owned client source period does not match the competitive report');
  const by_network: Record<string, any> = { ...base.by_network };
  for (const [network, raw] of Object.entries(owned.by_network || {}) as [string, any][]) {
    const snapshot = owned.audience_snapshot?.by_network?.[network];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rate: _rate, ...rest } = raw || {};
    const value = { ...rest, source: 'sprout' };
    by_network[network] = !valid(value.followers?.current) && valid(snapshot?.followers) && snapshot?.as_of
      ? { ...value, followers: { current: snapshot.followers, previous: null }, audience_as_of: snapshot.as_of }
      : value;
  }
  const networks = Object.values(by_network);
  const combined = (key: string, which: "current" | "previous", list: any[] = networks) => {
    const values = list.map((n) => n?.[key]?.[which]);
    return values.length && values.every(valid) ? values.reduce((a: number, b: number) => a + b, 0) : null;
  };
  const both = (key: string) => ({ current: combined(key, 'current'), previous: combined(key, 'previous') });
  const audienceNets = Object.entries(by_network).filter(([key, n]) => key !== 'linkedin' && valid(n?.followers?.current));
  const audience = audienceNets.length ? {
    current: combined('followers', 'current', audienceNets.map(([, n]) => n)),
    previous: audienceNets.some(([, n]) => n.audience_as_of) ? null : combined('followers', 'previous', audienceNets.map(([, n]) => n)),
  } : base.audience;
  const ownedEntries = Object.keys(owned.by_network || {}).map((network) => [network, by_network[network]] as [string, any]);
  return {
    ...base,
    by_network,
    posts: both('posts'),
    engagement: both('engagement'),
    audience,
    audience_as_of: audienceNets.some(([, n]) => n.audience_as_of) ? [...new Set(audienceNets.map(([, n]) => n.audience_as_of || base.period?.end))].sort().join(' / ') : undefined,
    metric_scopes: { ...base.metric_scopes, audience: audienceNets.some(([, n]) => n.source === 'sprout') ? 'sprout' : 'rivaliq' },
    audience_networks: audienceNets.map(([key]) => key),
    owned_profile_scope: ownedEntries.flatMap(([network, n]) => (n?.profiles || []).map((p: any) => ({ ...p, network }))),
  };
}

export function factualDimensions(companies: Company[], days: number | null): Dimension[] {
  const client = companies.find((c) => c.is_client);
  if (!client) return [];
  const rivals = companies.filter((c) => !c.is_client);
  const definitions: Array<[string, string, (c: Company) => Numeric]> = [
    ["Audience", "followers", (c) => competitiveCompanyMetrics(c)?.audience?.current],
    ["Cadence", "posts/week", (c) => days && valid(c.post_count) ? c.post_count / days * 7 : c.cadence_per_week],
    ["Engagement", "engagements", (c) => competitiveCompanyMetrics(c)?.engagement?.current ?? c.engagement_sum ?? c.engagement_total],
    // The impressions the engagement rate divides by: Sprout's measured ones for the client, RivalIQ's estimates for competitors.
    ["Impressions", "impressions", (c) => competitiveCompanyMetrics(c)?.impressions?.current ?? c.impressions_total],
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
  // The rate is always set: through engagementRate() from the company's
  // figures (Sprout's for the client, RivalIQ's for competitors), or null. A
  // rate stored by an older workflow (per follower, averaged per post) never
  // passes through to a screen.
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
    if (authoritative) for (const network of Object.keys(metrics?.by_network || {})) {
      const key = network === 'twitter' && channels.x ? 'x' : network;
      channels[key] ??= { post_count: 0 };
    }
    return {
      ...c,
      ...normalizeBucket(c, { ...metrics, impressions: metrics?.impressions }),
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
