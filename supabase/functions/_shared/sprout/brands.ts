// supabase/functions/_shared/sprout/brands.ts
//
// What one Sprout brand is, whether it is already a client, and whether it
// may become one (spec: docs/superpowers/specs/2026-11-02-sprout-auto-
// onboarding-design.md, sections 1 to 3).
//
// A brand is one Sprout group: the account's own grouping of its profiles.
// It is named as people know the brand, from its profiles' names
// (brandName), since a group's label is the team's shorthand ("ewc",
// "RMBH"); the group keeps its own name. Sprout names a brand's profiles differently on
// each network ("Olo - Skip the Line" on Facebook, "Olo App | Food Ordering"
// on Instagram, dry run of 2 Nov 2026), so names alone split one brand in
// two. Profiles in no group fall back to the lifecycle's name rule
// (names.ts), joined across networks by a shared handle. The website search
// can then join a brand in no group to another (website.ts, joinBrands), but
// never two Sprout groups to each other. A profile in two groups leaves both
// brands alone (groupConflict). The weekly onboarding job and the setup
// page's profile list (sprout-profiles) group through this one module, so
// they agree. Free of Deno and network imports so it can be tested.

import { profileKeyOf, type SproutProfile } from "../lifecycle/accounts.ts";
import { normName, sameName } from "../lifecycle/names.ts";
import { pathSegments, siteKeyOf, siteMatch } from "../net/domains.ts";
import type { CustomerGroup } from "./profiles.ts";
import { networkKey } from "./publishRules.ts";

export interface Brand {
  /** "group:<id>" for a Sprout group; else the brand's smallest profile id, which stays the same while profiles are added. */
  key: string;
  /** The brand as people know it, from its profiles' names (brandName); the group's name only when none is usable. */
  name: string;
  /** How the name was chosen, in a sentence. */
  name_reason: string;
  profiles: SproutProfile[];
  /** The Sprout group the brand is, or null for profiles in no group. */
  group: CustomerGroup | null;
}

/** A brand after the website search's joins, with the keys of the brands it is made of. */
export interface JoinedBrand extends Brand {
  members: string[];
}

/** A handle shorter than this never joins two groups: too many brands could share it. */
const MIN_JOIN_HANDLE = 3;

const isActive = (p: SproutProfile) => String(p.status || "active").toLowerCase() === "active";
const handleOf = (p: SproutProfile) => String(p.native_name || "").trim().toLowerCase().replace(/^@/, "");
const groupsOf = (p: SproutProfile) => [...new Set((p.groups ?? []).map(String).filter(Boolean))];
/** Profile ids are digits; a shorter one is older. */
const byId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
/** Brands in the order of their oldest profile. */
const byOldest = (a: Brand, b: Brand) => byId(String(a.profiles[0]?.id ?? ""), String(b.profiles[0]?.id ?? "")) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Groups of keys joined pairwise (union-find), each in id order. */
function unite(keys: string[], pairs: Array<[string, string]>): string[][] {
  const parent = new Map(keys.map((k) => [k, k]));
  const root = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const [a, b] of pairs) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const [x, y] = [root(a), root(b)].sort(byId);
    if (x !== y) parent.set(y, x);
  }
  const groups = new Map<string, string[]>();
  for (const k of keys) groups.set(root(k), [...(groups.get(root(k)) ?? []), k]);
  return [...groups.values()].map((g) => g.sort(byId)).sort((a, b) => byId(a[0], b[0]));
}

// ── The name a brand goes by ───────────────────────────────────────────────

/** A tagline after the brand's name: " | ", " - ", " \u2013 ", " \u2014 ", " (". */
const TAGLINE = /\s+\|\s*|\s*\|\s+|\s+[-\u2013\u2014]\s+|\s+\(/;
/** A legal suffix after the brand's name: Inc., LLC, Ltd, Corp, Co., GmbH, PLC. */
const LEGAL = /[\s,]+(?:inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|gmbh|plc)\.?$/i;
const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const quote = (names: string[]) => names.map((n) => `"${n}"`).join(", ");

/** A profile's name as the brand's name: before a tagline, without a legal suffix. */
export function profileBrandName(name: string | null | undefined): string {
  let n = String(name ?? "").trim().split(TAGLINE)[0].trim();
  while (LEGAL.test(n) && n.replace(LEGAL, "").trim()) n = n.replace(LEGAL, "").trim();
  return n;
}

/**
 * The name a brand goes by, from its profiles: each profile's brand name
 * (profileBrandName), leaving out names that look like handles (an
 * underscore or an @, or one run-together word that spells another profile's
 * name of several words), then the one most profiles share, a profile
 * sharing every name its own begins with ("Olo App" shares "Olo"), the
 * longest on a tie. The group's name only when no profile name is usable;
 * for profiles in no group, then, the spelling most of them carry.
 */
export function brandName(profiles: SproutProfile[], group: CustomerGroup | null = null): { name: string; why: string } {
  const cleaned = profiles.map((p) => profileBrandName(p.name)).filter(Boolean);
  const several = cleaned.filter((n) => wordsOf(n).length > 1);
  const handleLike = (n: string) => n.includes("_") || n.startsWith("@") || (!/\s/.test(n) && several.some((m) => wordsOf(m).join("") === wordsOf(n).join("")));
  const handles = [...new Set(cleaned.filter(handleLike))];
  const usable = cleaned.filter((n) => !handleLike(n) && wordsOf(n).length);
  const handleNote = handles.length ? `${quote(handles)} ${handles.length === 1 ? "looks like a handle" : "look like handles"}` : "";
  const groupName = group?.name.trim() ?? "";
  if (!usable.length) {
    if (groupName) return { name: groupName, why: `Named after its Sprout group "${groupName}": no profile name is usable${handleNote ? ` (${handleNote})` : ""}.` };
    const counts = new Map<string, number>();
    for (const p of profiles) { const n = String(p.name || "").trim(); if (n) counts.set(n, (counts.get(n) ?? 0) + 1); }
    let name = "";
    for (const [n, c] of counts) if (!name || c > counts.get(name)!) name = n;
    return { name, why: `Named "${name}" as Sprout spells it: no profile name is usable.` };
  }
  // Each distinct name, by its words, with how many profiles share it.
  const keys = [...new Map(usable.map((n) => [wordsOf(n).join(" "), n])).keys()];
  const shared = (key: string) => {
    const k = key.split(" ");
    return usable.filter((n) => { const w = wordsOf(n); return k.every((x, i) => w[i] === x); }).length;
  };
  const spelling = (key: string) => {
    const counts = new Map<string, number>();
    for (const n of usable) if (wordsOf(n).join(" ") === key) counts.set(n, (counts.get(n) ?? 0) + 1);
    let best = "";
    for (const [n, c] of counts) if (!best || c > counts.get(best)!) best = n;
    return best;
  };
  const most = Math.max(...keys.map(shared));
  const tied = keys.filter((k) => shared(k) === most).map(spelling);
  const name = tied.reduce((a, b) => (b.length > a.length ? b : a));
  const how = tied.length > 1
    ? `the longest of the names shared by the most profiles (${most} of ${usable.length} each: ${quote(tied)})`
    : usable.length === 1 ? "the only usable profile name" : `the name ${most} of its ${usable.length} profile names share`;
  const notes = [handleNote ? `${handleNote} and ${handles.length === 1 ? "is" : "are"} not used` : "", groupName ? `the Sprout group is "${groupName}"` : ""].filter(Boolean);
  return { name, why: `Named "${name}": ${how}${notes.length ? `; ${notes.join("; ")}` : ""}.` };
}

/**
 * A brand from its profiles: a group's is keyed by the group, others by the
 * oldest profile; named as people know it (brandName).
 */
export function brandOf(profiles: SproutProfile[], group: CustomerGroup | null = null): Brand {
  const sorted = [...new Map(profiles.map((p) => [String(p.id), p])).values()].sort((a, b) => byId(String(a.id), String(b.id)));
  const { name, why } = brandName(sorted, group);
  return {
    key: group ? `group:${group.id}` : String(sorted[0]?.id ?? ""),
    name,
    name_reason: why,
    profiles: sorted,
    group,
  };
}

/** Profiles in no group as brands: by the name rule, then joined by a handle shared across networks. */
function looseBrands(live: SproutProfile[]): Brand[] {
  const pairs: Array<[string, string]> = [];
  const byName = new Map<string, string>();
  for (const p of live) {
    const n = normName(p.name);
    if (!n) continue;
    const first = byName.get(n);
    if (first) pairs.push([first, String(p.id)]);
    else byName.set(n, String(p.id));
  }
  for (let i = 0; i < live.length; i++) {
    const h = handleOf(live[i]);
    if (h.length < MIN_JOIN_HANDLE) continue;
    for (let j = i + 1; j < live.length; j++) {
      if (handleOf(live[j]) === h && networkKey(live[i].network_type) !== networkKey(live[j].network_type)) pairs.push([String(live[i].id), String(live[j].id)]);
    }
  }
  const byId_ = new Map(live.map((p) => [String(p.id), p]));
  return unite(live.map((p) => String(p.id)), pairs).map((g) => brandOf(g.map((id) => byId_.get(id)!)));
}

/** Sprout's active profiles as brands: one per Sprout group, and the profiles in no group by the name rule. */
export function groupBrands(profiles: SproutProfile[], groups: CustomerGroup[] = []): Brand[] {
  const live = profiles.filter(isActive);
  const named = new Map(groups.map((g) => [String(g.id), g]));
  const members = new Map<string, SproutProfile[]>();
  const loose: SproutProfile[] = [];
  for (const p of live) {
    const ids = groupsOf(p);
    if (!ids.length) loose.push(p);
    for (const id of ids) members.set(id, [...(members.get(id) ?? []), p]);
  }
  const grouped = [...members.entries()].map(([id, ps]) => brandOf(ps, named.get(id) ?? { id, name: "" }));
  return [...grouped, ...looseBrands(loose)].sort(byOldest);
}

/**
 * Brands joined by pairs of brand keys (the website search's joins), each
 * named again. Two Sprout groups are never joined, not even through a brand
 * in no group: each group is a brand by the account's own grouping.
 */
export function joinBrands(brands: Brand[], pairs: Array<[string, string]>): JoinedBrand[] {
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const parent = new Map(brands.map((b) => [b.key, b.key]));
  const groupIn = new Map(brands.map((b) => [b.key, b.group ? b.key : null]));
  const root = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const [a, b] of pairs) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const [x, y] = [root(a), root(b)];
    if (x === y || (groupIn.get(x) && groupIn.get(y))) continue;
    parent.set(y, x);
    groupIn.set(x, groupIn.get(x) ?? groupIn.get(y) ?? null);
  }
  const parts = new Map<string, Brand[]>();
  for (const b of [...brands].sort(byOldest)) parts.set(root(b.key), [...(parts.get(root(b.key)) ?? []), b]);
  return [...parts.entries()].map(([r, members]) => {
    const groupKey = groupIn.get(r);
    const joined = brandOf(members.flatMap((m) => m.profiles), groupKey ? byKey.get(groupKey)!.group : null);
    return { ...joined, members: members.map((m) => m.key) };
  }).sort(byOldest);
}

const COUNT_WORDS = ["", "one", "two", "three", "four", "five"];

/** Why a brand is left alone because one of its profiles is in more than one Sprout group, or null. */
export function groupConflict(brand: Brand, groups: CustomerGroup[]): string | null {
  const shared = brand.profiles.find((p) => groupsOf(p).length > 1);
  if (!shared) return null;
  const named = new Map(groups.map((g) => [String(g.id), g.name.trim()]));
  const names = groupsOf(shared).map((id) => named.get(id) || `group ${id}`);
  const list = names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Left alone: its ${shared.network_type} profile ${shared.native_name || shared.name} is in ${COUNT_WORDS[names.length] ?? names.length} Sprout groups (${list}), so which brand it belongs to is unclear.`;
}

// ── Section 2: is the brand already a client? ──────────────────────────────

/** A client as the matching reads it. */
export interface KnownClient {
  id: string;
  name: string;
  website_url: string | null;
  archived_at: string | null;
  demo_job_id: string | null;
  /** The profile keys its homepage links to (brand_read's site_profiles). */
  site_profiles: string[];
}

export interface ClientIndex {
  /** Every client: active, archived and excluded from reporting. */
  clients: KnownClient[];
  /** Every assignment in sprout_profiles: profile id to client ids. */
  assigned: Map<string, string[]>;
  /** Every profile a person removed from a client (sprout_profile_removals): profile id to client ids. */
  removed: Map<string, string[]>;
}

export type MatchRule = "assigned" | "removed" | "name" | "site_link";

export interface BrandMatch {
  by: MatchRule;
  clients: KnownClient[];
}

/**
 * The client the brand already is, by the first rule that finds one, in
 * order: a profile assigned to it, a profile a person removed from it, its
 * name, a profile its homepage links to. A demo copy never counts, so a
 * prospect who signs still gets a real client.
 */
export function matchBrand(brand: Brand, index: ClientIndex): BrandMatch | null {
  const real = new Map(index.clients.filter((c) => !c.demo_job_id).map((c) => [String(c.id), c]));
  const pick = (ids: string[]) => [...new Set(ids)].map((id) => real.get(String(id))).filter((c): c is KnownClient => !!c);
  const ids = brand.profiles.map((p) => String(p.id));
  const keys = brand.profiles.map(profileKeyOf).filter((k): k is string => !!k);
  const rules: Array<[MatchRule, () => KnownClient[]]> = [
    ["assigned", () => pick(ids.flatMap((id) => index.assigned.get(id) ?? []))],
    ["removed", () => pick(ids.flatMap((id) => index.removed.get(id) ?? []))],
    ["name", () => [...real.values()].filter((c) => sameName(c.name, brand.name) || sameName(c.name, brand.group?.name) || brand.profiles.some((p) => sameName(c.name, p.name)))],
    ["site_link", () => [...real.values()].filter((c) => keys.some((k) => (c.site_profiles ?? []).includes(k)))],
  ];
  for (const [by, find] of rules) {
    const clients = find();
    if (clients.length) return { by, clients };
  }
  return null;
}

const BY_WORDS: Record<MatchRule, string> = {
  assigned: "its profiles are assigned to",
  removed: "a person removed one of its profiles from",
  name: "its name is the name of",
  site_link: "one of its profiles is linked from the homepage of",
};

export type MatchDecision = "matched" | "archived" | "removed" | "two_clients";

/** What the job does with a matched brand: nothing, and why. */
export function matchOutcome(m: BrandMatch): { decision: MatchDecision; reason: string; client_ids: string[] } {
  const client_ids = m.clients.map((c) => c.id);
  const names = m.clients.map((c) => c.name).join(" and ");
  if (m.by === "removed") return { decision: "removed", client_ids, reason: `Left alone for good: ${BY_WORDS.removed} ${names}, and a removal is never reversed.` };
  if (m.clients.length > 1) return { decision: "two_clients", client_ids, reason: `Left alone: it matches ${names} (${BY_WORDS[m.by]} each).` };
  if (m.clients[0].archived_at) return { decision: "archived", client_ids, reason: `Left alone for good: ${BY_WORDS[m.by]} ${names}, which is archived, and the job never brings a client back.` };
  return { decision: "matched", client_ids, reason: `Already a client: ${BY_WORDS[m.by]} ${names}. That client's accounts step adds new profiles within a day.` };
}

// ── A brand a person chose not to add ──────────────────────────────────────

/**
 * A person's decision not to add a Sprout brand as a client
 * (sprout_brand_declines): data, as a profile's removal is, never a list in
 * code. By the brand's Sprout group, and by its profiles.
 */
export interface BrandDecline {
  id: string;
  sprout_group_id: string | null;
  profile_ids: string[];
  brand: string;
  declined_at: string;
  note?: string | null;
}

/** The decline that covers this brand: its Sprout group's, else one that names any of its profiles. */
export function declineFor(brand: Brand, declines: BrandDecline[]): BrandDecline | null {
  const group = brand.group ? declines.find((d) => d.sprout_group_id && String(d.sprout_group_id) === String(brand.group!.id)) : null;
  if (group) return group;
  const ids = new Set(brand.profiles.map((p) => String(p.id)));
  return declines.find((d) => (d.profile_ids ?? []).some((id) => ids.has(String(id)))) ?? null;
}

/** Every profile of a declined brand, with its decline: what the staff list marks as declined. */
export function declinedProfiles(brands: Brand[], declines: BrandDecline[]): Map<string, BrandDecline> {
  const out = new Map<string, BrandDecline>();
  for (const brand of brands) {
    const d = declineFor(brand, declines);
    if (d) for (const p of brand.profiles) out.set(String(p.id), d);
  }
  return out;
}

/** Why a declined brand is left alone, with the day of the decision in Israel time. */
export function declineReason(d: Pick<BrandDecline, "declined_at">): string {
  const at = new Date(d.declined_at);
  const day = Number.isFinite(at.getTime()) ? ` on ${at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" })}` : "";
  return `Left alone for good: a person chose not to add it as a client${day}.`;
}

// ── Section 3: may an unmatched brand become a client? ─────────────────────

/** At least one brand account: Sprout types a personal LinkedIn profile "linkedin" and a company page "linkedin_company". */
export function isBrandAccount(brand: Brand): boolean {
  return brand.profiles.some((p) => String(p.network_type || "").toLowerCase() !== "linkedin");
}

/**
 * The client (never a demo copy) whose website is this site (net/domains.ts
 * siteMatch): a client on its host first, then one on its registrable
 * domain, so any subdomain counts; among those, the one whose website path
 * is shortest, so a root site comes before a page on it (Moburst before
 * Kitcaster's page on moburst.com). A client whose website is a subdomain of
 * its own (Uproar on uproar.moburst.com) is matched by that full host only.
 */
export function clientWithSite(site: string | null | undefined, clients: KnownClient[]): KnownClient | null {
  if (!siteKeyOf(site)) return null;
  const ranked = clients.filter((c) => !c.demo_job_id)
    .map((c, i) => ({ c, i, match: siteMatch(site, c.website_url), depth: pathSegments(c.website_url).length }))
    .filter((x) => x.match !== null)
    .sort((a, b) => Number(a.match === "site") - Number(b.match === "site") || a.depth - b.depth || a.i - b.i);
  return ranked[0]?.c ?? null;
}

export type CreationBlock = { decision: "person" | "no_posts" | "client_website"; reason: string; client_id?: string };

/**
 * Why an unmatched brand does not become a client, or null when it may: it
 * needs a brand account, a post in the last 90 days, and the site its posts
 * link to most must not be an existing client's (then it is that client's
 * secondary or internal account).
 */
export function blockedFromCreation(brand: Brand, facts: { posts: number; mostLinked: string | null }, clients: KnownClient[]): CreationBlock | null {
  if (!isBrandAccount(brand)) return { decision: "person", reason: "Left alone: every profile is a personal LinkedIn profile, so this is a person, not a brand." };
  if (facts.posts < 1) return { decision: "no_posts", reason: "Not created yet: Sprout has no post from it in the last 90 days. It is looked at again next run." };
  const owner = clientWithSite(facts.mostLinked, clients);
  if (owner) return { decision: "client_website", client_id: owner.id, reason: `Left alone: its posts link most to ${facts.mostLinked}, the website of ${owner.name}, so it is that client's secondary or internal account.` };
  return null;
}
