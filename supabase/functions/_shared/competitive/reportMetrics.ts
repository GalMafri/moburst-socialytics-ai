type Numeric = number | null | undefined;
type ProviderMetric = { current?: Numeric };
type ProviderNetwork = { posts?: ProviderMetric; rate?: ProviderMetric; engagement?: ProviderMetric; impressions?: ProviderMetric };
type Company = {
  owned_metrics?: any;
  rivaliq_audience_snapshot?: { as_of: string; audience: number; by_network?: Record<string, number> };
  linkedin_metrics?: { provider: string; period: {start: string; end: string}; posts: number; engagement: number; coverage: string };
  comparison_metrics?: any;
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

/** Retain each measured metric at its actual source scope. Adding LinkedIn
 * activity must not erase RivalIQ audience, impressions, or engagement rates. */
export function competitiveCompanyMetrics(c: {rivaliq_metrics?: any; linkedin_metrics?: any; rivaliq_audience_snapshot?: any;owned_metrics?:any}): any {
  const r = c.rivaliq_metrics;
  const li = c.linkedin_metrics;
  if (!r) return r;
  const snapshot = c.rivaliq_audience_snapshot;
  const useSnapshot = !valid(r.audience?.current) && valid(snapshot?.audience) && /^\d{4}-\d{2}-\d{2}$/.test(snapshot?.as_of || '');
  const base = {
    ...r,
    engagement_rate_per_post: r.posts?.current === 0 ? {...r.engagement_rate_per_post,current:null} : r.engagement_rate_per_post,
    audience: useSnapshot ? {current:snapshot.audience,previous:null} : r.audience,
    audience_as_of: useSnapshot ? snapshot.as_of : undefined,
    metric_scopes: {audience:'rivaliq',estimated_impressions:'rivaliq',engagement_rate_per_post:'rivaliq'},
    impression_post_count: r.posts?.current,
    by_network: Object.fromEntries(Object.entries(r.by_network || {}).map(([network, value]: [string, any]) => [network,
      useSnapshot && !valid(value.followers?.current) && valid(snapshot.by_network?.[network])
        ? {...value,followers:{current:snapshot.by_network[network],previous:null},audience_as_of:snapshot.as_of} : value,
    ])),
  };
  if (!li || li.coverage !== 'complete') return applyOwnedMetrics(base,c.owned_metrics);
  const add = (value: Numeric, extra: Numeric) => valid(value) && valid(extra) ? value + extra : null;
  const unknown = { current: null, previous: null };
  const previous = li.previous?.coverage === 'complete' && r.previous_period
    && li.previous.period?.start === r.previous_period.start && li.previous.period?.end === r.previous_period.end ? li.previous : null;
  return applyOwnedMetrics({
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
  },c.owned_metrics);
}

function applyOwnedMetrics(base:any,owned:any) {
  if(owned?.coverage!=='complete') return base;
  if(owned.period?.start!==base.period?.start||owned.period?.end!==base.period?.end) throw new Error('Owned client source period does not match the competitive report');
  const by_network={...base.by_network,...Object.fromEntries(Object.entries(owned.by_network).map(([network,value]:[string,any])=>{
    const snapshot=owned.audience_snapshot?.by_network?.[network];
    return [network,!valid(value.followers?.current)&&valid(snapshot?.followers)&&snapshot?.as_of
      ? {...value,followers:{current:snapshot.followers,previous:null},audience_as_of:snapshot.as_of}:value];
  }))};
  const combined=(key:string,which:string,networks=Object.values(by_network) as any[])=>{
    const values=networks.map(n=>n[key]?.[which]);
    return values.length&&values.every(valid)?values.reduce((a,b)=>a+b,0):null;
  };
  const both=(key:string)=>({current:combined(key,'current'),previous:combined(key,'previous')});
  const publicNetworks=Object.entries(by_network).filter(([key])=>key!=='linkedin');
  const audienceNets=publicNetworks.filter(([,n]:[string,any])=>valid(n.followers?.current));
  const rate=(which:string)=>{
    const active=publicNetworks.map(([,n])=>n as any).filter(n=>n.posts?.[which]>0);
    return active.length&&active.every(n=>valid(n.rate?.[which]))?active.reduce((sum,n)=>sum+n.rate[which]*n.posts[which],0)/active.reduce((sum,n)=>sum+n.posts[which],0):null;
  };
  const audience=audienceNets.length?{
    current:combined('followers','current',audienceNets.map(([,n])=>n)),
    previous:audienceNets.some(([,n]:[string,any])=>n.audience_as_of)?null:combined('followers','previous',audienceNets.map(([,n])=>n)),
  }:base.audience;
  const ownedNetworks=Object.values(owned.by_network) as any[];
  return {...base,by_network,posts:both('posts'),engagement:both('engagement'),audience,
    audience_as_of:audienceNets.some(([,n]:[string,any])=>n.audience_as_of)?[...new Set(audienceNets.map(([,n]:[string,any])=>n.audience_as_of||base.period.end))].sort().join(' / '):undefined,
    metric_scopes:{...base.metric_scopes,audience:'connected_and_public',engagement_rate_per_post:'connected_and_public'},
    audience_networks:audienceNets.map(([key])=>key),
    engagement_rate_per_post:{current:rate('current'),previous:rate('previous')},
    actual_impressions:{current:combined('impressions','current',ownedNetworks),previous:combined('impressions','previous',ownedNetworks)},
    owned_profile_scope:Object.values(owned.by_network).flatMap((n:any)=>n.profiles||[]),
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
  const providerValues = (posts: number | undefined, metrics?: ProviderNetwork & {impression_post_count?: Numeric}) => ({
    ...(metrics?.rate ? { engagement_rate_avg: valid(metrics.rate.current) ? metrics.rate.current : null } : {}),
    ...(posts && valid(metrics?.engagement?.current) ? { engagement_avg: metrics.engagement.current / posts } : {}),
    ...(metrics?.impressions ? { impressions_total: metrics.impressions.current ?? null, impressions_avg: valid(metrics.impressions.current) && (metrics.impression_post_count ?? posts) ? metrics.impressions.current / (metrics.impression_post_count ?? posts)! : null } : {}),
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
    const metrics = competitiveCompanyMetrics(c);
    const channels = { ...c.by_channel };
    if (authoritative) for (const network of Object.keys(metrics?.by_network || {})) {
      const key = network === 'twitter' && channels.x ? 'x' : network;
      channels[key] ??= { post_count: 0 };
    }
    return {
      ...c,
      comparison_metrics: metrics,
      ...normalizeBucket(c, { ...metrics, rate: metrics?.engagement_rate_per_post, impressions: metrics?.estimated_impressions }),
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
