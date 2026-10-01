/**
 * The data access the demo steps need, behind one interface: the steps are
 * tested against an in-memory version and run against supabase-js here.
 * Every row the job creates carries its demo_job_id; rows the project's own
 * functions create for the job (reports, competitor sets) are flagged after.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clientHost } from "../../_shared/net/clientHost.ts";
import type { ClientRow, CompetitiveReportRow, CompetitorRow, CompetitorSetRow, DesignSystemRow, PostRow, ReportRow, SetWithCompetitors, SproutProfileRow } from "../serializers.ts";
import { CLIENT_COLUMNS, COMPETITIVE_COLUMNS, COMPETITOR_COLUMNS, DESIGN_SYSTEM_COLUMNS, POST_COLUMNS, REPORT_COLUMNS, SET_COLUMNS, SPROUT_PROFILE_COLUMNS, setsWithCompetitors } from "../store.ts";

/** Neutralise the characters a PostgREST pattern match would interpret. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface DemoDb {
  findClientByHost(host: string): Promise<ClientRow | null>;
  findClientByName(name: string): Promise<ClientRow | null>;
  /** The user the job acts for: the requester when their email matches a profile, else the creator of the most clients. */
  ownerFor(email: string | null | undefined): Promise<string | null>;
  slugExists(slug: string): Promise<boolean>;
  insertClient(row: Record<string, unknown>): Promise<ClientRow>;
  updateClient(id: string, patch: Record<string, unknown>): Promise<void>;
  getClient(id: string): Promise<ClientRow | null>;
  sproutProfilesOf(clientId: string): Promise<SproutProfileRow[]>;
  /** Newest first, with competitors and handles. */
  setsOf(clientId: string): Promise<SetWithCompetitors[]>;
  insertSet(row: Record<string, unknown>): Promise<CompetitorSetRow>;
  updateSet(id: string, patch: Record<string, unknown>): Promise<void>;
  insertCompetitors(rows: Record<string, unknown>[]): Promise<CompetitorRow[]>;
  updateCompetitor(id: string, patch: Record<string, unknown>): Promise<void>;
  reportsOf(clientId: string): Promise<ReportRow[]>;
  competitiveReportsOf(clientId: string): Promise<CompetitiveReportRow[]>;
  getReports(ids: string[]): Promise<ReportRow[]>;
  getCompetitiveReports(ids: string[]): Promise<CompetitiveReportRow[]>;
  flagReport(table: "reports" | "competitive_reports", id: string, jobId: string): Promise<void>;
  postsForJob(jobId: string): Promise<PostRow[]>;
  insertPost(row: Record<string, unknown>): Promise<PostRow>;
  updatePost(id: string, patch: Record<string, unknown>): Promise<void>;
  designSystemsOf(clientId: string): Promise<DesignSystemRow[]>;
  /** The reach of the key that created the job: null when the key is gone. */
  keyReach(keyId: string): Promise<{ company_slugs: string[] | null; client_ids: string[] | null } | null>;
  clientSlugs(): Promise<Array<{ id: string; company_slug: string | null }>>;
}

async function rows<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
async function one<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data as T | null) ?? null;
}
async function must<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const r = await one<T>(p);
  if (!r) throw new Error(`${what} returned nothing`);
  return r;
}
async function run(p: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await p;
  if (error) throw new Error(error.message);
}

export function makeDemoDb(db: SupabaseClient): DemoDb {
  return {
    async findClientByHost(host) {
      const candidates = await rows<ClientRow>(db.from("clients").select(CLIENT_COLUMNS).is("archived_at", null).ilike("website_url", `%${escapeLike(host)}%`).limit(20));
      return candidates.find((c) => clientHost(c.website_url) === host) ?? null;
    },
    async findClientByName(name) {
      return one<ClientRow>(db.from("clients").select(CLIENT_COLUMNS).is("archived_at", null).ilike("name", escapeLike(name)).limit(1).maybeSingle());
    },
    async ownerFor(email) {
      if (email) {
        const p = await one<{ user_id: string }>(db.from("profiles").select("user_id").ilike("email", escapeLike(email)).limit(1).maybeSingle());
        if (p?.user_id) return p.user_id;
      }
      const owners = await rows<{ created_by: string | null }>(db.from("clients").select("created_by").is("archived_at", null).limit(500));
      const tally = new Map<string, number>();
      for (const r of owners) if (r.created_by) tally.set(r.created_by, (tally.get(r.created_by) ?? 0) + 1);
      return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    },
    async slugExists(slug) {
      return (await rows<{ id: string }>(db.from("clients").select("id").eq("company_slug", slug).limit(1))).length > 0;
    },
    insertClient: (row) => must<ClientRow>(db.from("clients").insert(row).select(CLIENT_COLUMNS).single(), "client insert"),
    updateClient: (id, patch) => run(db.from("clients").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id)),
    getClient: (id) => one<ClientRow>(db.from("clients").select(CLIENT_COLUMNS).eq("id", id).maybeSingle()),
    sproutProfilesOf: (clientId) => rows<SproutProfileRow>(db.from("sprout_profiles").select(SPROUT_PROFILE_COLUMNS).eq("client_id", clientId)),
    async setsOf(clientId) {
      return setsWithCompetitors(db, await rows<CompetitorSetRow>(db.from("competitor_sets").select(SET_COLUMNS).eq("client_id", clientId).order("created_at", { ascending: false }).limit(20)));
    },
    insertSet: (row) => must<CompetitorSetRow>(db.from("competitor_sets").insert(row).select(SET_COLUMNS).single(), "competitor set insert"),
    updateSet: (id, patch) => run(db.from("competitor_sets").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id)),
    insertCompetitors: (list) => rows<CompetitorRow>(db.from("competitors").insert(list).select(COMPETITOR_COLUMNS)),
    updateCompetitor: (id, patch) => run(db.from("competitors").update(patch).eq("id", id)),
    reportsOf: (clientId) => rows<ReportRow>(db.from("reports").select(REPORT_COLUMNS).eq("client_id", clientId).order("created_at", { ascending: false }).limit(20)),
    competitiveReportsOf: (clientId) => rows<CompetitiveReportRow>(db.from("competitive_reports").select(COMPETITIVE_COLUMNS).eq("client_id", clientId).order("created_at", { ascending: false }).limit(20)),
    getReports: (ids) => (ids.length ? rows<ReportRow>(db.from("reports").select(REPORT_COLUMNS).in("id", ids)) : Promise.resolve([])),
    getCompetitiveReports: (ids) => (ids.length ? rows<CompetitiveReportRow>(db.from("competitive_reports").select(COMPETITIVE_COLUMNS).in("id", ids)) : Promise.resolve([])),
    flagReport: (table, id, jobId) => run(db.from(table).update({ demo_job_id: jobId }).eq("id", id)),
    postsForJob: (jobId) => rows<PostRow>(db.from("post_iterations").select(POST_COLUMNS).eq("demo_job_id", jobId).order("created_at", { ascending: true })),
    insertPost: (row) => must<PostRow>(db.from("post_iterations").insert(row).select(POST_COLUMNS).single(), "post insert"),
    updatePost: (id, patch) => run(db.from("post_iterations").update(patch).eq("id", id)),
    designSystemsOf: (clientId) => rows<DesignSystemRow>(db.from("client_design_systems").select(DESIGN_SYSTEM_COLUMNS).eq("client_id", clientId).neq("status", "retired").order("version", { ascending: false })),
    keyReach: (keyId) => one<{ company_slugs: string[] | null; client_ids: string[] | null }>(db.from("api_keys").select("company_slugs, client_ids").eq("id", keyId).maybeSingle()),
    clientSlugs: () => rows<{ id: string; company_slug: string | null }>(db.from("clients").select("id, company_slug").is("archived_at", null)),
  };
}
