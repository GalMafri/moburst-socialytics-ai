const cfg = $("Run Config").first().json;
const body = (() => { try { return $("Competitive Webhook").first().json.body || {}; } catch (e) { return {}; } })();
const resp = $input.first().json;
const list = resp.landscapes || resp.data || resp.items || (Array.isArray(resp) ? resp : []);
if (!Array.isArray(list) || list.length === 0) {
  throw new Error("NO_LANDSCAPES on this RivalIQ account");
}
const host = value => {
  const raw = String(value || '').trim();
  if (!raw || /\s/.test(raw)) return '';
  const hostname = raw.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return hostname.includes('.') && /^[a-z0-9.-]+$/.test(hostname) ? hostname : '';
};
const normalizedName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/(?:\s+(?:inc|incorporated|ltd|limited|llc|llp|plc|corp|corporation))+$/, '').trim();
const clientHost = host(body.website_url) || host(cfg.client_name);
const clientMatchesIn = l => (l.companies || []).filter(c => clientHost ? host(c.url) === clientHost : !!normalizedName(cfg.client_name) && normalizedName(c.name) === normalizedName(cfg.client_name));
let selected = [];
try { selected = JSON.parse(cfg.competitors_json || '[]'); } catch { selected = []; }
const selectedMatchesIn = l => selected.map(s => (l.companies || []).filter(c => {
  if (clientMatchesIn(l).some(client => String(client.id) === String(c.id))) return false;
  const website = host(s.website_url);
  // A saved provider id does not override a conflicting reviewed website.
  if (s.rivaliq_company_id != null && String(c.id) !== String(s.rivaliq_company_id)) return false;
  return website ? host(c.url) === website : normalizedName(c.name) === normalizedName(s.name);
}));
const selectionFits = l => {
  const matches = selectedMatchesIn(l);
  return matches.every(a => a.length === 1) && new Set(matches.flat().map(c => String(c.id))).size === selected.length;
};
let match;
let matchedBy;
if (cfg.landscape_hint) {
  match = list.find(l => String(l.id) === String(cfg.landscape_hint));
  matchedBy = 'explicit id';
} else {
  const candidates = list.filter(l => clientMatchesIn(l).length === 1 && selectionFits(l));
  candidates.sort((a, b) => Number(String(clientMatchesIn(b)[0].id) === String(b.focusCompanyId)) - Number(String(clientMatchesIn(a)[0].id) === String(a.focusCompanyId)));
  match = candidates[0];
  matchedBy = 'verified client and selected companies';
}
if (!match) throw new Error('LANDSCAPE_NOT_FOUND — no RivalIQ landscape tracks the client and the confirmed competitors. Connect tracking for this selection.');
const clientMatches = clientMatchesIn(match);
if (clientMatches.length !== 1) throw new Error('CLIENT_IDENTITY_UNVERIFIED — the selected landscape does not uniquely track the client website.');
if (!selectionFits(match)) throw new Error('TRACKING_SELECTION_MISMATCH — the selected landscape must track every confirmed competitor with the reviewed website exactly once.');
const companies = (match.companies || []).map((c) => ({
  id: c.id,
  name: c.name,
  url: c.url || null,
  is_focus: String(c.id) === String(match.focusCompanyId),
  handles: {
    instagram: c.instagram ? c.instagram.handle : null,
    facebook: c.facebook ? c.facebook.handle : null,
    tiktok: c.tikTok ? c.tikTok.handle : null,
    twitter: c.twitter ? c.twitter.handle : null,
    youtube: c.youTube ? c.youTube.url : null,
    linkedin: c.linkedin ? c.linkedin.handle : null
  }
}));
return [{ json: { landscape_id: match.id, landscape_name: match.name, matched_by: matchedBy, focus_company_id: match.focusCompanyId, client_company_id: clientMatches[0].id, companies } }];
