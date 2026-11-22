import { followFailure } from './rivaliqFollowFailure.ts';
// API-only setup, with each non-idempotent request recorded before dispatch.
// A lost POST response is reconciled by reads; it is never blindly retried.
export type SetupCompany = { id: string; name: string; url: string };
export type SetupPlan = { set_id: string; client_id: string; name: string; companies: SetupCompany[] };
export type SetupJob = { phase: string; landscape_id?: string | null; operation_token?: string | null; plan: SetupPlan };
type Company = { id: string | number; url?: string };
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type Save = (patch: Partial<SetupJob>) => Promise<void>;

export function publicCompanyUrl(value: string): string {
  const raw = String(value || '').trim();
  const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port ||
      !host.includes('.') || /(^|[.-])(localhost|local|internal|staging|stage|preview|qa|test|dev)([.-]|$)/.test(host) ||
      /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) {
    throw new Error('Use the public company website, not a staging, private or social-profile URL.');
  }
  if (['facebook.com','instagram.com','linkedin.com','tiktok.com','youtube.com','x.com','twitter.com'].some(d => host === d || host.endsWith(`.${d}`))) {
    throw new Error('Use the company website rather than a social-profile URL.');
  }
  return `https://${host}/`;
}

export function matchSetupCompanies(plan: SetupPlan, companies: Company[]): Company[] | null {
  const matched = plan.companies.map(wanted => companies.filter(c => {
    try { return publicCompanyUrl(c.url || '') === wanted.url; } catch { return false; }
  }));
  if (matched.some(m => m.length !== 1)) return null;
  const result = matched.map(m => m[0]);
  return new Set(result.map(c => String(c.id))).size === plan.companies.length ? result : null;
}

/**
 * The landscape does not hold exactly one company for every reviewed website.
 * `missing` names the reviewed websites RivalIQ holds no single company for.
 * QA 22 Nov 2026 (P31-01, P31-02): a type of its own, so the server run can
 * send the follow again instead of reading the same empty answer forever.
 */
export class UnmatchedCompanies extends Error {
  constructor(public missing: string[]) {
    super(`RivalIQ has not returned exactly one company for every reviewed website${missing.length ? ` (${missing.join(', ')})` : ''}. Nothing was linked; check status later.`);
    this.name = 'UnmatchedCompanies';
  }
}

const hostOf = (url: string) => url.replace(/^https:\/\//, '').replace(/\/$/, '');

/** The reviewed websites RivalIQ holds no single company for. */
function unmatchedWebsites(plan: SetupPlan, companies: Company[]): string[] {
  return plan.companies.filter(wanted => companies.filter(c => {
    try { return publicCompanyUrl(c.url || '') === wanted.url; } catch { return false; }
  }).length !== 1).map(c => hostOf(c.url));
}

/**
 * QA 22 Nov 2026 (P31-02): a landscape this setup made and followed, that
 * holds exactly as many companies as the plan, all but one matched by
 * website: the one left is the reviewed website's company, stored by RivalIQ
 * under the address that website sends visitors to (adaptivesound.com held
 * as yogasleep.com). Only after RivalIQ said every website was followed.
 */
function matchByElimination(plan: SetupPlan, companies: Company[]): Company[] | null {
  if (companies.length !== plan.companies.length) return null;
  const claims = plan.companies.map(wanted => companies.filter(c => {
    try { return publicCompanyUrl(c.url || '') === wanted.url; } catch { return false; }
  }));
  const missing = claims.map((m, i) => (m.length ? -1 : i)).filter(i => i >= 0);
  if (missing.length !== 1 || claims.some(m => m.length > 1)) return null;
  const used = new Set(claims.flat().map(c => String(c.id)));
  const spare = companies.filter(c => !used.has(String(c.id)));
  if (spare.length !== 1) return null;
  claims[missing[0]] = [spare[0]];
  const result = claims.map(m => m[0]);
  return new Set(result.map(c => String(c.id))).size === plan.companies.length ? result : null;
}

export async function advanceRivalIqSetup(job: SetupJob, api: Api, save: Save): Promise<SetupJob> {
  if (job.phase === 'retired') {
    throw new Error('This abandoned tracking setup was removed. Use the current confirmed selection, or create a new draft with verified company websites.');
  }
  const update = async (patch: Partial<SetupJob>) => { await save(patch); Object.assign(job, patch); };
  if (job.phase === 'ready') {
    const list = await api('/landscapes');
    // Reuse only a landscape containing every reviewed website, including
    // the client. Never follow/unfollow companies in somebody else's set.
    const existing = (list.landscapes || []).filter((l: any) => l.companies?.length === job.plan.companies.length && matchSetupCompanies(job.plan, l.companies));
    if (existing.length > 1) throw new Error('Several existing landscapes contain these companies. Import the intended landscape instead of creating another.');
    if (existing.length === 1) {
      await update({ landscape_id: String(existing[0].id), phase: 'verify' });
      return job;
    }
    await update({ phase: 'create_requested' });
    const created = await api('/landscapes', 'POST', { name: job.plan.name });
    if (!created.landscape?.id) throw new Error('Creation response was incomplete. Check setup status before proceeding.');
    await update({ landscape_id: String(created.landscape.id), phase: 'created' });
    return job;
  }
  if (job.phase === 'create_requested') {
    const list = await api('/landscapes');
    const found = (list.landscapes || []).filter((l: any) => l.name === job.plan.name);
    if (!found.length) throw new Error('Creation outcome is uncertain. No duplicate request was sent; provider review is required.');
    // QA 22 Nov 2026 (P31-04): several landscapes can carry this setup's name
    // (one left by an earlier selection of the same set). The name holds the
    // set's id, so every one is ours: take the one already holding most of the
    // plan's companies rather than stopping here for good.
    const held = (l: any) => job.plan.companies.length - unmatchedWebsites(job.plan, l.companies || []).length;
    const chosen = [...found].sort((a: any, b: any) => held(b) - held(a))[0];
    await update({ landscape_id: String(chosen.id), phase: 'created' });
    return job;
  }
  if (!job.landscape_id) throw new Error('Setup has no landscape ID. Provider review is required.');
  const path = `/landscapes/${encodeURIComponent(job.landscape_id)}`;
  if (job.phase === 'created') {
    await update({ phase: 'follow_requested' });
    const followed = await api(`${path}/companies/byUrl`, 'POST', { companyUrls: job.plan.companies.map(c => c.url) });
    if (!followed.token) throw new Error('Tracking response was incomplete. Check status; do not start another setup.');
    await update({ operation_token: String(followed.token), phase: 'following' });
    return job;
  }
  if (['following', 'following_failed'].includes(job.phase)) {
    const pending = await api(`/pendingOperations/${encodeURIComponent(job.operation_token || '')}`);
    if (pending.status === 1) return job;
    if (pending.status !== 2 || Object.values(pending.urls || {}).some((u: any) => u.status !== 2)) {
      const failures = Object.entries(pending.urls || {}).filter(([, result]: any) => result.status === 3)
        .map(([url, result]: any) => {
          let company = job.plan.companies.find(c => c.url === url);
          try { company ||= job.plan.companies.find(c => c.url === publicCompanyUrl(url)); } catch { /* unknown provider URL */ }
          return { name: company?.name || 'Reviewed company', result };
        });
      await update({ phase: 'following_failed' });
      // Per-company answers become one plain sentence (plan capacity, a website that refused the visit, the provider's own words).
      if (failures.length) throw followFailure(failures);
      const detail = (typeof pending.error === 'string' ? pending.error : JSON.stringify(pending.error || 'Check account capacity and company URLs.')).slice(0, 300);
      throw new Error(`RivalIQ could not finish tracking every reviewed website. ${detail}`);
    }
    await update({ phase: 'verify' });
    return job;
  }
  if (['follow_requested', 'verify'].includes(job.phase)) {
    const response = await api(`${path}/companies`);
    const companies: Company[] = response.companies || [];
    let matched = matchSetupCompanies(job.plan, companies);
    let landscape: any = null;
    if (!matched && job.phase === 'verify') {
      ({ landscape } = await api(path));
      if (landscape?.name === job.plan.name) matched = matchByElimination(job.plan, companies);
    }
    if (!matched) throw new UnmatchedCompanies(unmatchedWebsites(job.plan, companies));
    if (!landscape) ({ landscape } = await api(path));
    // A bulk follow can finish competitors before the client. Only adjust a
    // landscape created for this selection; an imported shared set keeps its focus.
    if (landscape?.name === job.plan.name && String(landscape.focusCompanyId) !== String(matched[0].id)) {
      const changed = await api(path, 'PUT', { focusCompanyId: Number(matched[0].id) });
      if (String(changed.landscape?.focusCompanyId) !== String(matched[0].id)) {
        throw new Error('The client focus could not be verified. Check tracking again before running a report.');
      }
    }
    await update({ phase: 'verified' });
  }
  return job;
}

/**
 * Removing a landscape a setup created but never filled (the follow step
 * failed, so the companies were never added). Only a landscape carrying this
 * setup's own name, and only while it tracks no company: a shared or imported
 * landscape, or one that holds companies, is never touched.
 */
export async function cleanupRivalIqLandscape(job: SetupJob, api: Api): Promise<{ deleted: boolean; reason: 'empty' | 'no_landscape' | 'not_found' | 'not_ours' | 'has_companies' }> {
  if (!job.landscape_id) return { deleted: false, reason: 'no_landscape' };
  const path = `/landscapes/${encodeURIComponent(job.landscape_id)}`;
  const { landscape } = await api(path);
  if (!landscape) return { deleted: false, reason: 'not_found' };
  if (landscape.name !== job.plan.name) return { deleted: false, reason: 'not_ours' };
  const response = await api(`${path}/companies`);
  if ((response.companies || []).length) return { deleted: false, reason: 'has_companies' };
  await api(path, 'DELETE');
  return { deleted: true, reason: 'empty' };
}
