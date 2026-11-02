/** An in-memory Store for the route tests: the same filters and keyset paging over fixture rows. */
import type { ClientScope } from "../_shared/api/router.ts";
import type { AlertRow, ClientRow, CompetitiveReportRow, CompetitorRow, CompetitorSetRow, DesignSystemRow, HandleRow, MediaJobRow, PostRow, ReportRow, ScheduledPostRow, ScheduleRow, SetWithCompetitors, SproutProfileRow } from "./serializers.ts";
import type { ClientExtras, Page, Store } from "./store.ts";

export interface FakeData {
  clients: ClientRow[]; sproutProfiles: SproutProfileRow[]; sets: CompetitorSetRow[]; competitors: CompetitorRow[]; handles: HandleRow[]; reports: ReportRow[]; competitiveReports: CompetitiveReportRow[];
  posts: PostRow[]; mediaJobs: MediaJobRow[]; schedules: ScheduleRow[]; scheduledPosts: ScheduledPostRow[]; alerts: AlertRow[]; designSystems: DesignSystemRow[];
}
export function emptyData(over: Partial<FakeData> = {}): FakeData {
  return { clients: [], sproutProfiles: [], sets: [], competitors: [], handles: [], reports: [], competitiveReports: [], posts: [], mediaJobs: [], schedules: [], scheduledPosts: [], alerts: [], designSystems: [], ...over };
}

function keyset<T extends { id: string; created_at: string }>(rowsIn: T[], page: Page): T[] {
  const sorted = [...rowsIn].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  const after = page.cursor ? sorted.filter((r) => r.created_at < page.cursor!.c || (r.created_at === page.cursor!.c && r.id < page.cursor!.i)) : sorted;
  return after.slice(0, page.limit + 1);
}
const inScope = <T extends { client_id: string }>(rowsIn: T[], scope: ClientScope) => rowsIn.filter((r) => scope.allows(r.client_id));

export function makeFakeStore(d: FakeData): Store {
  const full = (sets: CompetitorSetRow[]): SetWithCompetitors[] => sets.map((s) => ({ ...s, competitors: d.competitors.filter((c) => c.set_id === s.id).map((c) => ({ ...c, handles: d.handles.filter((h) => h.competitor_id === c.id) })) }));
  const byClient = <T extends { client_id: string }>(rowsIn: T[], id?: string) => rowsIn.filter((r) => !id || r.client_id === id);
  return {
    async listClients(scope, f, page) {
      let c = d.clients.filter((x) => scope.allows(x.id) && (f.include_archived || !x.archived_at));
      if (f.q) c = c.filter((x) => x.name.toLowerCase().includes(f.q!.toLowerCase()));
      if (f.company_slug) c = c.filter((x) => x.company_slug === f.company_slug);
      return keyset(c, page);
    },
    async getClient(id, scope) { return scope.allows(id) ? d.clients.find((c) => c.id === id) ?? null : null; },
    async clientExtras(ids) {
      const out: Record<string, ClientExtras> = {};
      for (const id of ids) {
        const reports = [...d.reports.filter((r) => r.client_id === id)].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        out[id] = {
          sproutProfiles: d.sproutProfiles.filter((p) => p.client_id === id), sets: full(d.sets.filter((s) => s.client_id === id)), designSystems: d.designSystems.filter((s) => s.client_id === id && s.status !== "retired"),
          counts: { reports: reports.length, competitive_reports: d.competitiveReports.filter((r) => r.client_id === id).length, posts: d.posts.filter((p) => p.client_id === id && !p.archived_at).length, schedules: d.schedules.filter((s) => s.client_id === id && s.is_active).length },
          lastReport: reports[0] ?? null,
        };
      }
      return out;
    },
    async schedulesOf(id) { return d.schedules.filter((s) => s.client_id === id); },
    async listReports(scope, f, page) { return keyset(inScope(byClient(d.reports, f.client_id), scope).filter((r) => (!f.status || r.status === f.status) && (!f.from || r.created_at >= f.from) && (!f.to || r.created_at <= f.to)), page); },
    async getReport(id, scope) { const r = d.reports.find((x) => x.id === id) ?? null; return r && scope.allows(r.client_id) ? r : null; },
    async listCompetitiveReports(scope, f, page) { return keyset(inScope(byClient(d.competitiveReports, f.client_id), scope).filter((r) => !f.status || r.status === f.status), page); },
    async getCompetitiveReport(id, scope) { const r = d.competitiveReports.find((x) => x.id === id) ?? null; return r && scope.allows(r.client_id) ? r : null; },
    async listSets(scope, f, page) { return full(keyset(inScope(byClient(d.sets, f.client_id), scope).filter((s) => !f.status || s.status === f.status), page)); },
    async getSet(id, scope) { const s = d.sets.find((x) => x.id === id) ?? null; return s && scope.allows(s.client_id) ? full([s])[0] : null; },
    async listPosts(scope, f, page) {
      return keyset(inScope(byClient(d.posts, f.client_id), scope).filter((p) => (f.include_archived || !p.archived_at) && (!f.report_id || p.report_id === f.report_id) && (!f.source || p.source === f.source) && (f.approved == null || !!p.is_approved === f.approved)), page);
    },
    async getPost(id, scope) { const p = d.posts.find((x) => x.id === id) ?? null; return p && scope.allows(p.client_id) ? p : null; },
    async listMediaJobs(scope, f, page) { return keyset(inScope(byClient(d.mediaJobs, f.client_id), scope).filter((m) => !f.status || m.status === f.status), page); },
    async listSchedules(scope, f, page) { return keyset(inScope(byClient(d.schedules, f.client_id), scope), page); },
    async listScheduledPosts(scope, f, page) { return keyset(inScope(byClient(d.scheduledPosts, f.client_id), scope).filter((s) => !f.status || s.status === f.status), page); },
    async listAlerts(scope, f, page) { return keyset(inScope(byClient(d.alerts, f.client_id), scope).filter((a) => !f.status || a.status === f.status), page); },
    async listDesignSystems(scope, f, page) { return keyset(inScope(byClient(d.designSystems, f.client_id), scope), page); },
  };
}
