/** In-memory DemoDb for the step tests: the same operations the steps make on production, over plain arrays. */
import type { ClientRow, CompetitiveReportRow, CompetitorRow, CompetitorSetRow, DesignSystemRow, HandleRow, PostRow, ReportRow, SproutProfileRow } from "../serializers.ts";
import type { DemoDb } from "./db.ts";

export interface FakeTables {
  clients: ClientRow[]; sproutProfiles: SproutProfileRow[]; sets: CompetitorSetRow[]; competitors: CompetitorRow[]; handles: HandleRow[]; reports: ReportRow[]; competitiveReports: CompetitiveReportRow[];
  posts: PostRow[]; designSystems: DesignSystemRow[]; profiles: Array<{ user_id: string; email: string }>; owners: string[]; keys: Array<{ id: string; company_slugs: string[] | null; client_ids: string[] | null }>;
}
export function emptyTables(over: Partial<FakeTables> = {}): FakeTables {
  return { clients: [], sproutProfiles: [], sets: [], competitors: [], handles: [], reports: [], competitiveReports: [], posts: [], designSystems: [], profiles: [], owners: ["u-owner"], keys: [{ id: "k-1", company_slugs: null, client_ids: null }], ...over };
}

const host = (u: string | null | undefined) => (u ?? "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
let seq = 0;
const id = (p: string) => `${p}-${++seq}`;
const now = () => new Date().toISOString();
const newest = <T extends { created_at: string }>(r: T[]) => [...r].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

export function makeFakeDemoDb(t: FakeTables): DemoDb {
  const full = (sets: CompetitorSetRow[]) => sets.map((s) => ({ ...s, competitors: t.competitors.filter((c) => c.set_id === s.id).map((c) => ({ ...c, handles: t.handles.filter((h) => h.competitor_id === c.id) })) }));
  return {
    async findDemoClientByHost(h) { return t.clients.find((c) => !c.archived_at && c.demo_job_id && host(c.website_url) === h) ?? null; },
    async findDemoClientByName(name) { return t.clients.find((c) => !c.archived_at && c.demo_job_id && c.name.toLowerCase() === name.toLowerCase()) ?? null; },
    async ownerFor(email) { const p = email ? t.profiles.find((x) => x.email === email) : null; return p?.user_id ?? t.owners[0] ?? null; },
    async slugExists(slug) { return t.clients.some((c) => c.company_slug === slug); },
    async insertClient(row) {
      const defaults = { website_url: null, company_slug: null, primary_platforms: null, geo: null, language: null, timezone: null, content_pillars: null, social_keywords: null, brand_identity: null, brief_text: null, logo_url: null, design_style_synthesis: null, harvested_design_references: null, design_references: null, archived_at: null, demo_job_id: null };
      const c = { ...defaults, ...row, id: id("c"), created_at: now() } as ClientRow; t.clients.push(c); return c;
    },
    async updateClient(cid, patch) { Object.assign(t.clients.find((c) => c.id === cid)!, patch); },
    async getClient(cid) { return t.clients.find((c) => c.id === cid) ?? null; },
    async sproutProfilesOf(cid) { return t.sproutProfiles.filter((p) => p.client_id === cid); },
    async setsOf(cid) { return full(newest(t.sets.filter((s) => s.client_id === cid))); },
    async insertSet(row) { const s = { notes: null, source: null, rivaliq_landscape_id: null, confirmed_at: null, demo_job_id: null, ...row, id: id("set"), created_at: now() } as CompetitorSetRow; t.sets.push(s); return s; },
    async updateSet(sid, patch) { Object.assign(t.sets.find((s) => s.id === sid)!, patch); },
    async insertCompetitors(list) { return list.map((row) => { const c = { website_url: null, rationale: null, similarity_score: null, source: null, is_selected: false, selected_rank: null, profile_detection: null, ...row, id: id("comp"), created_at: now() } as CompetitorRow; t.competitors.push(c); return c; }); },
    async updateCompetitor(cid, patch) { Object.assign(t.competitors.find((c) => c.id === cid)!, patch); },
    async reportsOf(cid) { return newest(t.reports.filter((r) => r.client_id === cid)); },
    async competitiveReportsOf(cid) { return newest(t.competitiveReports.filter((r) => r.client_id === cid)); },
    async getReports(ids) { return t.reports.filter((r) => ids.includes(r.id)); },
    async getCompetitiveReports(ids) { return t.competitiveReports.filter((r) => ids.includes(r.id)); },
    async flagReport(table, rid, jobId) { const list = table === "reports" ? t.reports : t.competitiveReports; const r = list.find((x) => x.id === rid); if (r) r.demo_job_id = jobId; },
    async postsForJob(jobId) { return t.posts.filter((p) => p.demo_job_id === jobId); },
    async insertPost(row) { const p = { report_id: null, recommendation_index: null, version: 1, post_copy: null, hashtags: [], cta: null, concept: null, visual_direction: null, format: null, source: null, media_urls: [], variant_group_id: null, is_selected: false, variant_angle: null, is_approved: false, approved_at: null, rejected_at: null, rejection_reason: null, archived_at: null, finishing: null, demo_job_id: null, ...row, id: id("post"), created_at: now() } as PostRow; t.posts.push(p); return p; },
    async updatePost(pid, patch) { Object.assign(t.posts.find((p) => p.id === pid)!, patch); },
    async designSystemsOf(cid) { return [...t.designSystems.filter((d) => d.client_id === cid && d.status !== "retired")].sort((a, b) => b.version - a.version); },
    async keyReach(keyId) { const k = t.keys.find((x) => x.id === keyId); return k ? { company_slugs: k.company_slugs, client_ids: k.client_ids } : null; },
    async clientSlugs() { return t.clients.filter((c) => !c.archived_at).map((c) => ({ id: c.id, company_slug: c.company_slug })); },
  };
}
