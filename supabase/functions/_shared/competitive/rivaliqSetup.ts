import { describeFollowFailure } from './rivaliqFollowFailure.ts';
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
    if (found.length !== 1) throw new Error('Creation outcome is uncertain. No duplicate request was sent; provider review is required.');
    await update({ landscape_id: String(found[0].id), phase: 'created' });
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
      if (failures.length) throw new Error(describeFollowFailure(failures));
      const detail = (typeof pending.error === 'string' ? pending.error : JSON.stringify(pending.error || 'Check account capacity and company URLs.')).slice(0, 300);
      throw new Error(`RivalIQ could not finish tracking every reviewed website. ${detail}`);
    }
    await update({ phase: 'verify' });
    return job;
  }
  if (['follow_requested', 'verify'].includes(job.phase)) {
    const response = await api(`${path}/companies`);
    const matched = matchSetupCompanies(job.plan, response.companies || []);
    if (!matched) {
      throw new Error('RivalIQ has not returned exactly one company for every reviewed website. Nothing was linked; check status later.');
    }
    const { landscape } = await api(path);
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
