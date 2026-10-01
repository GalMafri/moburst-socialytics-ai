/**
 * The outputs a finished demo hands back: the client, the competitor set,
 * the reports with their decks, the highlights of the social and competitive
 * analyses, the generated post, the analytics snapshot, the design system
 * and every gap recorded on the way. Pure.
 */
import type { Gap } from "../../_shared/api/jobs.ts";
import { APP_URL, competitiveReportOut, designSystemOut, pillarsOut, postOut, reportOut, type BrandIdentity, type ClientRow, type CompetitiveReportOut, type CompetitiveReportRow, type DesignSystemRow, type PostOut, type PostRow, type ReportOut, type ReportRow, type SetWithCompetitors } from "../serializers.ts";

export interface Unplaced { name: string; reason: string }
type Linked<T> = T & { app_link: string; api_link: string };

export interface DemoOutputs {
  client: { id: string; name: string; website: string | null; company_slug: string | null; brand_identity: BrandIdentity | null; pillars: Array<{ name: string; description: string | null }>; keywords: string[]; app_link: string; api_link: string };
  competitors: { set_id: string | null; set_status: string | null; selected: Array<{ name: string; website: string | null; handles: string[] }>; unplaced: Unplaced[]; tracked: boolean };
  reports: Array<Linked<ReportOut> & { kind: "social" } | Linked<CompetitiveReportOut> & { kind: "competitive" }>;
  social_report: { id: string; status: string; period: ReportOut["period"]; counts: Record<string, unknown> | null; highlights: string[]; calendar_days: number; deck: ReportOut["deck"]; app_link: string; api_link: string } | null;
  competitive_report: { id: string; status: string; period: CompetitiveReportOut["period"]; executive_summary: string | null; scorecard: unknown; gaps: unknown[]; deck: CompetitiveReportOut["deck"]; quality_check: unknown; app_link: string; api_link: string } | null;
  post: Linked<PostOut> | null;
  analytics: Record<string, unknown> | null;
  design: { status: "approved" | "draft" | "none"; version: number | null; previews: Array<{ template_id: string | null; format: string | null; url: string | null }> };
  gaps: Gap[];
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function buildOutputs(i: { client: ClientRow; set: SetWithCompetitors | null; unplaced: Unplaced[]; reports: ReportRow[]; competitive: CompetitiveReportRow[]; posts: PostRow[]; designs: DesignSystemRow[]; analytics: Record<string, unknown> | null; gaps: Gap[] }): DemoOutputs {
  const c = i.client;
  const social = [...i.reports].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const comp = [...i.competitive].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const bestSocial = social.find((r) => r.status === "completed") ?? social[0] ?? null;
  const bestComp = comp.find((r) => r.status === "complete") ?? comp[0] ?? null;
  const link = <T extends { links: { app: string; api: string } }>(o: T) => ({ ...o, app_link: o.links.app, api_link: o.links.api });
  const design = i.designs.find((d) => d.status === "approved") ?? i.designs[0] ?? null;
  const post = i.posts.find((p) => (p.media_urls ?? []).length) ?? i.posts[0] ?? null;
  const socialOut = bestSocial ? reportOut(bestSocial, { detail: true }) : null;
  const compOut = bestComp ? competitiveReportOut(bestComp, { detail: true }) : null;
  const analysis = obj(socialOut?.analysis);
  const highlights = strs(obj(analysis.sprout_performance_analysis).key_insights);
  return {
    client: { id: c.id, name: c.name, website: c.website_url, company_slug: c.company_slug, brand_identity: c.brand_identity, pillars: pillarsOut(c.content_pillars), keywords: strs(c.social_keywords), app_link: `${APP_URL}/clients/${c.id}/setup`, api_link: `/v1/clients/${c.id}` },
    competitors: {
      set_id: i.set?.id ?? null, set_status: i.set?.status ?? null,
      selected: (i.set?.competitors ?? []).filter((k) => k.is_selected).sort((a, b) => (a.selected_rank ?? 99) - (b.selected_rank ?? 99)).map((k) => ({ name: k.name, website: k.website_url, handles: k.handles.filter((h) => h.is_active !== false).map((h) => `${h.platform}:${h.handle}`) })),
      unplaced: i.unplaced, tracked: !!i.set?.rivaliq_landscape_id,
    },
    reports: [...social.map((r) => ({ ...link(reportOut(r)), kind: "social" as const })), ...comp.map((r) => ({ ...link(competitiveReportOut(r)), kind: "competitive" as const }))],
    social_report: socialOut ? { id: socialOut.id, status: socialOut.status, period: socialOut.period, counts: socialOut.counts, highlights, calendar_days: socialOut.calendar?.length ?? 0, deck: socialOut.deck, app_link: socialOut.links.app, api_link: socialOut.links.api } : null,
    competitive_report: compOut ? { id: compOut.id, status: compOut.status, period: compOut.period, executive_summary: typeof obj(compOut.analysis).executive_summary === "string" ? (obj(compOut.analysis).executive_summary as string) : null, scorecard: obj(compOut.analysis).benchmark_scorecard ?? null, gaps: Array.isArray(obj(compOut.analysis).gaps_for_client) ? (obj(compOut.analysis).gaps_for_client as unknown[]) : [], deck: compOut.deck, quality_check: compOut.quality_check, app_link: compOut.links.app, api_link: compOut.links.api } : null,
    post: post ? link(postOut(post)) : null,
    analytics: i.analytics,
    design: design ? { status: design.status === "approved" ? "approved" : "draft", version: design.version, previews: designSystemOut(design).previews.slice(0, 4) } : { status: "none", version: null, previews: [] },
    gaps: i.gaps,
  };
}
