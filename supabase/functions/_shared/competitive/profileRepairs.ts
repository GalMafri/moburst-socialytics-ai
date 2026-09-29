import { publicCompanyUrl } from './rivaliqSetup.ts';
import { isReviewReadyHandle } from './extractSocialHandles.ts';

type Handle = { platform: string; handle: string; is_active: boolean; source: string; detection_confidence?: number | string | null };
type Selected = { name: string; website_url: string; handles: Handle[] };
type Tracked = { id: number | string; url?: string; [key: string]: any };
const fields: Record<string, string> = { facebook: 'facebook', instagram: 'instagram', x: 'twitter', twitter: 'twitter', youtube: 'youTube' };

/** Website discovery can omit a profile that was already reviewed in the app.
 * Fill only missing, API-supported presences; never overwrite a tracked profile.
 */
export function missingProfileRepairs(selected: Selected[], tracked: Tracked[]) {
  return selected.flatMap(company => {
    const matches = tracked.filter(c => {
      try { return publicCompanyUrl(c.url || '') === publicCompanyUrl(company.website_url); } catch { return false; }
    });
    if (matches.length !== 1) throw new Error(`${company.name} is not uniquely tracked. Review the connected competitor selection before running a report.`);
    const current = matches[0];
    const patch: Record<string, { handle: string } | { nativeId: string }> = {};
    for (const profile of company.handles.filter(isReviewReadyHandle)) {
      const field = fields[profile.platform];
      const handle = profile.handle?.trim().replace(/^@/, '');
      if (!field || !handle || current[field]?.handle || current[field]?.nativeId || current[field]?.url) continue;
      const value = field === 'youTube' && /^UC[\w-]{22}$/.test(handle) || field === 'facebook' && /^\d+$/.test(handle)
        ? { nativeId: handle } : { handle };
      if (patch[field] && JSON.stringify(patch[field]) !== JSON.stringify(value)) throw new Error(`${company.name} has multiple reviewed ${profile.platform} profiles. Choose one primary profile before running a report.`);
      patch[field] = value;
    }
    return Object.keys(patch).length ? [{ companyId: current.id, name: company.name, patch }] : [];
  });
}
