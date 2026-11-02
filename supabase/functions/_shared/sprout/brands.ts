// supabase/functions/_shared/sprout/brands.ts
//
// What one Sprout brand is, whether it is already a client, and whether it
// may become one (spec: docs/superpowers/specs/2026-11-02-sprout-auto-
// onboarding-design.md, sections 1 to 3).
//
// A brand is the active profiles whose Sprout names are equal by the
// lifecycle's name rule (names.ts), the rule the accounts step matches by.
// Two such groups are one brand when a profile in one has the same handle as
// a profile in the other on another network, or when the website search
// ties them (website.ts, then joinBrands). The weekly onboarding job and the
// setup page's profile list (sprout-profiles) group through this one module,
// so they agree. Free of Deno and network imports so it can be tested.

import { profileKeyOf, type SproutProfile } from "../lifecycle/accounts.ts";
import { normName, sameName } from "../lifecycle/names.ts";
import { clientHost } from "../net/clientHost.ts";
import { networkKey } from "./publishRules.ts";

export interface Brand {
  /** The brand's smallest profile id: it stays the same while profiles are added. */
  key: string;
  /** The spelling most of its profiles carry. */
  name: string;
  profiles: SproutProfile[];
}

/** A handle shorter than this never joins two groups: too many brands could share it. */
const MIN_JOIN_HANDLE = 3;

const isActive = (p: SproutProfile) => String(p.status || "active").toLowerCase() === "active";
const handleOf = (p: SproutProfile) => String(p.native_name || "").trim().toLowerCase().replace(/^@/, "");
/** Profile ids are digits; a shorter one is older. */
const byId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

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

/** A brand from its profiles: keyed by the oldest, named by the most common spelling (the oldest profile's on a tie). */
export function brandOf(profiles: SproutProfile[]): Brand {
  const sorted = [...profiles].sort((a, b) => byId(String(a.id), String(b.id)));
  const counts = new Map<string, number>();
  for (const p of sorted) {
    const n = String(p.name || "").trim();
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let name = "";
  for (const [n, c] of counts) if (!name || c > counts.get(name)!) name = n;
  return { key: String(sorted[0]?.id ?? ""), name, profiles: sorted };
}

/** Sprout's active profiles as brands: by the name rule, then joined by a handle shared across networks. */
export function groupBrands(profiles: SproutProfile[]): Brand[] {
  const live = profiles.filter(isActive);
  const ids = live.map((p) => String(p.id));
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
  return unite(ids, pairs).map((g) => brandOf(g.map((id) => byId_.get(id)!)));
}

/** Brands joined by pairs of brand keys (the website search's joins), each named again. */
export function joinBrands(brands: Brand[], pairs: Array<[string, string]>): Brand[] {
  const byKey = new Map(brands.map((b) => [b.key, b]));
  return unite(brands.map((b) => b.key), pairs).map((g) => brandOf(g.flatMap((k) => byKey.get(k)!.profiles)));
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
    ["name", () => [...real.values()].filter((c) => sameName(c.name, brand.name) || brand.profiles.some((p) => sameName(c.name, p.name)))],
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

// ── Section 3: may an unmatched brand become a client? ─────────────────────

/** At least one brand account: Sprout types a personal LinkedIn profile "linkedin" and a company page "linkedin_company". */
export function isBrandAccount(brand: Brand): boolean {
  return brand.profiles.some((p) => String(p.network_type || "").toLowerCase() !== "linkedin");
}

/** The client (never a demo copy) whose website is this host or a site under it. */
export function clientWithSite(host: string | null | undefined, clients: KnownClient[]): KnownClient | null {
  const h = clientHost(host);
  if (!h) return null;
  return clients.find((c) => {
    if (c.demo_job_id) return false;
    const site = clientHost(c.website_url);
    return !!site && (h === site || h.endsWith(`.${site}`));
  }) ?? null;
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
