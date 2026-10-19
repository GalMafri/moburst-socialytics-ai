// supabase/functions/_shared/competitive/rivaliqSetupRun.ts
//
// RivalIQ tracking for a confirmed competitor set, run on the server (Lital,
// 19 Oct 2026, decision 1: tracking connects automatically, using paid
// company slots for the client and its three competitors). The sequence
// itself is rivaliqSetup.ts (every non-idempotent request recorded before it
// is sent, a lost answer reconciled by reads); this file holds what used to
// live only in the setup-rivaliq-landscape function: the plan, the lease on
// the rivaliq_setup_jobs row, the API with the key kept out of every
// message, and linking the verified landscape to the set. The function still
// answers the Competitors screen with one step per call; the client
// lifecycle's tracking step advances the same row until it is complete.
// After tracking is linked, each tracked company's handles are taken from
// RivalIQ's own record of it, the exact source.

import { rivalIqFetch } from "./rivaliqFetch.ts";
import { advanceRivalIqSetup, publicCompanyUrl, type SetupJob, type SetupPlan } from "./rivaliqSetup.ts";
import { companyToHandles, type RivalIqCompany } from "./rivaliqLandscape.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
export type Api = (path: string, method?: string, body?: unknown) => Promise<any>;

export const LINKABLE_STATUSES = ["confirmed", "complete", "failed"];

export class SetupError extends Error {
  constructor(public code: "set_missing" | "not_linkable" | "selection" | "archived" | "changed" | "busy", message: string, public status = 422) {
    super(message);
  }
}

export async function planFingerprint(plan: SetupPlan): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(plan)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The companies RivalIQ should track for a set: the client first, then the three ranked competitors. */
export async function setupPlan(db: Db, setId: string): Promise<SetupPlan> {
  const { data: set, error: se } = await db.from("competitor_sets").select("id, client_id, status").eq("id", setId).maybeSingle();
  if (se) throw se;
  if (!set) throw new SetupError("set_missing", "Competitor set not found", 404);
  const { data: client, error: ce } = await db.from("clients").select("id, name, website_url, archived_at").eq("id", set.client_id).single();
  if (ce) throw ce;
  if (client.archived_at) throw new SetupError("archived", "Archived clients cannot start provider tracking.");
  const { data: selected, error: pe } = await db.from("competitors").select("id, name, website_url, selected_rank").eq("set_id", setId).eq("is_selected", true).order("selected_rank");
  if (pe) throw pe;
  // deno-lint-ignore no-explicit-any
  if (selected?.length !== 3 || selected.some((c: any, i: number) => c.selected_rank !== i + 1)) throw new SetupError("selection", "Select and rank exactly three competitors first.");
  // deno-lint-ignore no-explicit-any
  const companies = [client, ...selected].map((c: any) => {
    try {
      return { id: c.id, name: c.name, url: publicCompanyUrl(c.website_url) };
    } catch (e) {
      throw new SetupError("selection", `${c.name}: ${e instanceof Error ? e.message : "no public website"}`);
    }
  });
  if (new Set(companies.map((c) => c.url)).size !== 4) throw new SetupError("selection", "The client and three competitors must have distinct public websites.");
  return { set_id: set.id, client_id: set.client_id, name: `Socialytics - ${client.name.slice(0, 40)} - ${set.id}`, companies };
}

/** The RivalIQ API with the key, its every copy removed from what comes back. Never retries a write. */
export function rivalIqApi(key: string, fetchImpl: typeof rivalIqFetch = rivalIqFetch): Api {
  return async (path, method = "GET", payload) => {
    const response = await fetchImpl(`https://api.rivaliq.com/v3${path}?apiKey=${encodeURIComponent(key)}`, {
      method, headers: { Accept: "application/json", "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`RivalIQ returned HTTP ${response.status}. Check API permissions or account capacity, then check setup status. No automatic POST retry was sent.`);
    const text = await response.text();
    if (!text.trim()) return {};
    return JSON.parse(JSON.stringify(JSON.parse(text), (_name, value) => typeof value === "string"
      ? value.replaceAll(key, "[redacted]").replaceAll(encodeURIComponent(key), "[redacted]") : value));
  };
}

export interface LeasedJob {
  job: SetupJob & { set_id: string; fingerprint: string; landscape_id?: string | null };
  leaseId: string;
  save(patch: Partial<SetupJob>): Promise<void>;
  release(): Promise<void>;
}

/** Create the set's setup row when it has none, then hold its lease. Null when another run holds it. */
export async function leaseSetupJob(db: Db, plan: SetupPlan, hash: string, seconds = 120): Promise<LeasedJob | null> {
  const { error: insertError } = await db.from("rivaliq_setup_jobs").upsert({ set_id: plan.set_id, client_id: plan.client_id, plan, fingerprint: hash }, { onConflict: "set_id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const leaseId = crypto.randomUUID();
  const now = new Date();
  const { data: job, error } = await db.from("rivaliq_setup_jobs")
    .update({ lease_id: leaseId, lease_until: new Date(now.getTime() + seconds * 1000).toISOString() })
    .eq("set_id", plan.set_id).eq("fingerprint", hash)
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select("*").maybeSingle();
  if (error) throw error;
  if (!job) return null;
  return {
    job, leaseId,
    async save(patch) {
      const { data, error: e } = await db.from("rivaliq_setup_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("set_id", plan.set_id).eq("lease_id", leaseId).select("set_id").maybeSingle();
      if (e || !data) throw new Error("Could not save setup progress. Check its status before trying again.");
    },
    async release() {
      await db.from("rivaliq_setup_jobs").update({ lease_id: null, lease_until: null }).eq("set_id", plan.set_id).eq("lease_id", leaseId);
    },
  };
}

/** Link a verified landscape to its set, unless the selection changed or the set is analyzing. */
export async function linkVerified(db: Db, plan: SetupPlan, hash: string, landscapeId: string): Promise<void> {
  if (await planFingerprint(await setupPlan(db, plan.set_id)) !== hash) throw new SetupError("changed", "Selection changed during setup. Tracking was preserved but not linked.");
  const { data: linked, error } = await db.from("competitor_sets").update({ rivaliq_landscape_id: landscapeId })
    .eq("id", plan.set_id).in("status", LINKABLE_STATUSES).select("id").maybeSingle();
  if (error || !linked) throw new SetupError("busy", "Tracking is verified, but the set changed or is analyzing. Check setup again once it is ready.");
}

export type ServerSetupOutcome =
  | { state: "complete"; landscape_id: string; phase: "complete" }
  /** RivalIQ is still adding the companies: look again later. `since` is when the setup last moved. */
  | { state: "pending"; phase: string; landscape_id: string | null; since: string | null }
  /** Another run holds the setup row. */
  | { state: "busy" };

/**
 * Advance the set's setup until it is complete, RivalIQ is still working, or
 * the time budget is spent. A follow that failed is sent again on the next
 * run (plan capacity can free up), and a create whose answer was lost and
 * that left nothing behind is started again. Errors are thrown for the
 * caller's quiet retry.
 */
export async function advanceSetupOnServer(db: Db, setId: string, api: Api, opts: { budgetMs?: number; now?: () => number } = {}): Promise<ServerSetupOutcome> {
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? 90_000;
  const plan = await setupPlan(db, setId);
  const hash = await planFingerprint(plan);
  const { data: prior, error: je } = await db.from("rivaliq_setup_jobs").select("set_id, fingerprint, phase").eq("set_id", setId).maybeSingle();
  if (je) throw je;
  // A setup row for an earlier selection of this set: the confirmed selection is the one to track.
  if (prior && prior.fingerprint !== hash) {
    const { error } = await db.from("rivaliq_setup_jobs").delete().eq("set_id", setId).eq("fingerprint", prior.fingerprint).is("lease_id", null);
    if (error) throw error;
  }
  const leased = await leaseSetupJob(db, plan, hash, Math.ceil(budget / 1000) + 60);
  if (!leased) return { state: "busy" };
  try {
    const job = leased.job;
    // Done before, but the set lost its link (or never got it while it was analyzing): link it again.
    if (job.phase === "complete" && job.landscape_id) {
      await linkVerified(db, plan, hash, String(job.landscape_id));
      return { state: "complete", landscape_id: String(job.landscape_id), phase: "complete" };
    }
    // A follow that failed is sent again; a setup removed as abandoned starts again for the confirmed set.
    if (job.phase === "following_failed") {
      await leased.save({ phase: "created", operation_token: null });
      job.phase = "created";
    } else if (job.phase === "retired") {
      await leased.save({ phase: "ready", landscape_id: null, operation_token: null });
      Object.assign(job, { phase: "ready", landscape_id: null, operation_token: null });
    }
    // deno-lint-ignore no-explicit-any
    const since = (job as any).updated_at ? String((job as any).updated_at) : null;
    for (let steps = 0; steps < 8 && now() - started < budget; steps++) {
      const before = job.phase;
      try {
        await advanceRivalIqSetup(job, api, leased.save);
      } catch (e) {
        // A create whose answer was lost and that left no landscape behind never happened: start it again.
        if (job.phase === "create_requested" && /Creation outcome is uncertain/.test(e instanceof Error ? e.message : "")) {
          const list = await api("/landscapes");
          // deno-lint-ignore no-explicit-any
          if (!(list.landscapes || []).some((l: any) => l.name === job.plan.name)) {
            await leased.save({ phase: "ready" });
            job.phase = "ready";
            continue;
          }
        }
        throw e;
      }
      if (job.phase === "verified") {
        await linkVerified(db, plan, hash, String(job.landscape_id));
        await leased.save({ phase: "complete" });
        return { state: "complete", landscape_id: String(job.landscape_id), phase: "complete" };
      }
      // Still following: RivalIQ is adding the companies.
      if (job.phase === before && job.phase === "following") return { state: "pending", phase: job.phase, landscape_id: job.landscape_id ?? null, since };
    }
    return { state: "pending", phase: job.phase, landscape_id: job.landscape_id ?? null, since: new Date(now()).toISOString() };
  } finally {
    await leased.release();
  }
}

/** Start the set's tracking again from nothing: its landscape is gone or no longer tracks the client. */
export async function resetTracking(db: Db, setId: string, missingLandscapeId: string | null): Promise<void> {
  if (missingLandscapeId) {
    const { error } = await db.from("competitor_sets").update({ rivaliq_landscape_id: null }).eq("id", setId).eq("rivaliq_landscape_id", missingLandscapeId);
    if (error) throw error;
  }
  const { error } = await db.from("rivaliq_setup_jobs").delete().eq("set_id", setId).is("lease_id", null);
  if (error) throw error;
}

export interface TrackedCompanies {
  /** RivalIQ's record of the client company, with its handles. */
  client: { company_id: string; name: string; url: string | null; handles: Array<{ platform: string; handle: string; profile_url: string | null }> } | null;
  competitors: number;
  handles: number;
}

/**
 * Each tracked company's id and handles from RivalIQ's own record (one
 * call). A competitor is matched to its tracked company by public website;
 * a handle a person typed or removed is never overwritten.
 */
export async function syncTrackedHandles(db: Db, setId: string, landscapeId: string, clientWebsite: string | null, api: Api): Promise<TrackedCompanies> {
  const response = await api(`/landscapes/${encodeURIComponent(landscapeId)}/companies`);
  const companies = (response.companies || []) as RivalIqCompany[];
  const urlOf = (v: string | null | undefined) => { try { return publicCompanyUrl(String(v || "")); } catch { return null; } };
  const byUrl = new Map<string, RivalIqCompany>();
  for (const c of companies) { const u = urlOf(c.url); if (u && !byUrl.has(u)) byUrl.set(u, c); }
  const { data: selected, error } = await db.from("competitors").select("id, client_id, website_url").eq("set_id", setId).eq("is_selected", true);
  if (error) throw error;
  const ids = (selected ?? []).map((c: { id: string }) => c.id);
  const { data: kept, error: keptError } = ids.length
    ? await db.from("competitor_handles").select("competitor_id, platform").in("competitor_id", ids).in("source", ["manual", "rejected"])
    : { data: [], error: null };
  if (keptError) throw keptError;
  const personal = new Set((kept ?? []).map((r: { competitor_id: string; platform: string }) => `${r.competitor_id}:${r.platform}`));
  let matched = 0, written = 0;
  for (const comp of selected ?? []) {
    const url = urlOf(comp.website_url);
    const tracked = url ? byUrl.get(url) : undefined;
    if (!tracked) continue;
    matched++;
    const { error: idError } = await db.from("competitors").update({ rivaliq_company_id: String(tracked.id) }).eq("id", comp.id);
    if (idError) throw idError;
    for (const h of companyToHandles(tracked)) {
      if (personal.has(`${comp.id}:${h.platform}`)) continue;
      const { error: upError } = await db.from("competitor_handles").upsert({
        competitor_id: comp.id, client_id: comp.client_id, platform: h.platform, handle: h.handle, profile_url: h.profile_url,
        is_active: true, detection_confidence: 1, source: "rivaliq", detected_at: new Date().toISOString(),
      }, { onConflict: "competitor_id,platform" });
      if (upError) throw upError;
      written++;
    }
  }
  const own = urlOf(clientWebsite);
  const clientCompany = own ? byUrl.get(own) : undefined;
  return {
    client: clientCompany ? { company_id: String(clientCompany.id), name: String(clientCompany.name || ""), url: clientCompany.url ?? null, handles: companyToHandles(clientCompany) } : null,
    competitors: matched,
    handles: written,
  };
}
