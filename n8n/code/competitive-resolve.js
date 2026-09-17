const cfg = $("Run Config").first().json;
const body = (() => { try { return $("Competitive Webhook").first().json.body || {}; } catch (e) { return {}; } })();
const resp = $input.first().json;
const list = resp.landscapes || resp.data || resp.items || (Array.isArray(resp) ? resp : []);
if (!Array.isArray(list) || list.length === 0) {
  throw new Error("NO_LANDSCAPES on this RivalIQ account");
}
const clientNeedle = String(cfg.client_name || "").toLowerCase().trim();
let selected = [];
try { selected = JSON.parse(cfg.competitors_json || "[]"); } catch (e) { selected = []; }
const selectedNames = selected.map((s) => String(s.name || "").toLowerCase()).filter(Boolean);
const focusOf = (l) => (l.companies || []).find((c) => String(c.id) === String(l.focusCompanyId)) || null;
const focusName = (l) => { const f = focusOf(l); return f ? String(f.name || "").toLowerCase() : ""; };
const nameHit = (a, b) => a && b && (a.includes(b) || b.includes(a));
// The registrable stem of a URL or bare domain: "https://www.Moburst.com/x"
// and "Moburst.com" both give "moburst". RivalIQ companies are named however
// whoever built the landscape typed them, so the website is the reliable key.
const stem = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const host = raw.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  if (!host.includes(".")) return "";
  const parts = host.split(".").filter(Boolean);
  while (parts.length > 1 && parts[parts.length - 1].length <= 3) parts.pop();
  return parts[parts.length - 1] || "";
};
const clientStem = stem(body.website_url) || stem(cfg.client_name);
const overlap = (l) => (l.companies || []).filter((c) => selectedNames.some((sn) => nameHit(String(c.name || "").toLowerCase(), sn))).length;
let match = null;
let matchedBy = "";
if (cfg.landscape_hint) {
  match = list.find((l) => String(l.id) === String(cfg.landscape_hint)) || null;
  if (match) matchedBy = "explicit id";
}
if (!match && clientNeedle) {
  match = list.find((l) => String(l.name || "").toLowerCase().includes(clientNeedle)) || null;
  if (match) matchedBy = "landscape name";
}
if (!match && clientNeedle) {
  const byFocus = list.filter((l) => nameHit(focusName(l), clientNeedle));
  if (byFocus.length > 0) {
    byFocus.sort((a, b) => overlap(b) - overlap(a));
    match = byFocus[0];
    matchedBy = byFocus.length > 1 ? "focus company (best competitor overlap of " + byFocus.length + ")" : "focus company";
  }
}
if (!match && clientStem) {
  const byUrl = list.filter((l) => { const f = focusOf(l); return f && (stem(f.url) === clientStem || stem(f.name) === clientStem); });
  if (byUrl.length > 0) {
    byUrl.sort((a, b) => overlap(b) - overlap(a));
    match = byUrl[0];
    matchedBy = "focus company website";
  }
}
if (!match && clientStem) {
  const byMember = list.filter((l) => (l.companies || []).some((c) => stem(c.url) === clientStem));
  if (byMember.length > 0) {
    byMember.sort((a, b) => overlap(b) - overlap(a));
    match = byMember[0];
    matchedBy = "client is tracked in the set";
  }
}
if (!match) {
  // No colon in this message. The writeback stores JSON.stringify of it and a
  // ": " used to truncate the stored reason to a fragment ("bader law) [line 37]").
  const names = list.map((l) => l.name + " (focus " + (focusName(l) || "none") + ")").join("; ");
  throw new Error("LANDSCAPE_NOT_FOUND — no RivalIQ landscape tracks " + cfg.client_name + ". Create one with " + cfg.client_name + " as the focus company, or import an existing one. Available landscapes are " + names);
}
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
const host = value => String(value || '').toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
const clientHost = host(body.website_url);
const clientMatches = companies.filter(c => nameHit(String(c.name || '').toLowerCase(), clientNeedle) || (!!clientHost && host(c.url) === clientHost));
if (clientMatches.length !== 1) throw new Error("CLIENT_IDENTITY_UNVERIFIED — " + cfg.client_name + " is not uniquely tracked in the selected RivalIQ landscape. Its focus company must not be used as a substitute. Add the client's own company and profiles in RivalIQ.");
return [{ json: { landscape_id: match.id, landscape_name: match.name, matched_by: matchedBy, focus_company_id: match.focusCompanyId, client_company_id: clientMatches[0].id, companies } }];
