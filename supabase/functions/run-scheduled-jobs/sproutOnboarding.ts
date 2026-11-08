// The weekly Sprout onboarding job (spec: docs/superpowers/specs/2026-11-02-
// sprout-auto-onboarding-design.md). Lital, 2 Nov 2026: "do a weekly sample
// of our Sprout Social clients and then whoever is not built into Sociallytics
// onboard them automatically."
//
// enqueue_sprout_onboarding_job queues one run on Monday (or after 8 days
// with none). A run lists Sprout's profiles and groups, takes each Sprout
// group as one brand (_shared/sprout/brands.ts; profiles in no group by the
// name rule), named as people know it from its profiles' names (the client
// goes by that name; its origin keeps the group's label), leaves a brand a
// person chose not to add (sprout_brand_declines, data like a profile's
// removal) alone for good, leaves a group with a profile in two groups alone, and leaves every brand that already is a
// client to that client: an active one's accounts step adds new profiles
// within a day; an archived client's brand, a profile a person removed, and a
// brand matching two clients are left alone for good. An unmatched brand
// becomes a client when it has a brand account, a post in the last 90 days,
// and its posts do not link most to an existing client's site; its website
// is searched in those posts (_shared/sprout/website.ts), and the website
// search can tie two brands into one. sprout_onboard_client makes the client
// under a lock; the lifecycle, which its insert triggers start, does the rest.
//
// A run works within 90 seconds and queues itself a minute later with the
// brands left. Its result lists every brand with what was done and why. The
// harness mode sprout_onboarding_dry_run runs the same thing and writes
// nothing. Nothing here alerts anyone or makes a model call.

import type { SproutProfile } from "../_shared/lifecycle/accounts.ts";
import { blockedFromCreation, clientWithSite, declineFor, declineReason, groupBrands, groupConflict, isBrandAccount, joinBrands, matchBrand, matchOutcome, type Brand, type BrandDecline, type ClientIndex, type KnownClient, type MatchDecision } from "../_shared/sprout/brands.ts";
import { listBrandPosts, POSTS_WINDOW_DAYS, type SproutPost } from "../_shared/sprout/posts.ts";
import { listCustomerGroups, listCustomerProfiles, type CustomerGroup } from "../_shared/sprout/profiles.ts";
import { searchWebsite, webReader, websiteJoins, type SiteFact, type SiteReader, type WebsiteSearch } from "../_shared/sprout/website.ts";
import { siteKeyOf } from "../_shared/net/domains.ts";
import type { JobOutcome, ScheduledJob } from "../_shared/scheduled-jobs/types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** How long one run looks at brands before it leaves the rest to the next run, a minute later. */
export const RUN_BUDGET_MS = 90_000;
const DAY = 86_400_000;
const PAGE = 1000;

export interface OnboardingDeps {
  now(): Date;
  /** Every profile on the Sprout account, with the groups each is in. */
  profiles(): Promise<SproutProfile[]>;
  /** The account's Sprout groups, with their names. */
  groups(): Promise<CustomerGroup[]>;
  /** A brand's posts between two dates. */
  posts(profileIds: string[], since: Date, until: Date): Promise<SproutPost[]>;
  reader: SiteReader;
  budgetMs: number;
  /** Milliseconds, for the budget. */
  clock(): number;
}

export function liveOnboardingDeps(): OnboardingDeps {
  return {
    now: () => new Date(),
    profiles: () => listCustomerProfiles(),
    groups: () => listCustomerGroups(),
    posts: (ids, since, until) => listBrandPosts(ids, { since, until }),
    reader: webReader(),
    budgetMs: RUN_BUDGET_MS,
    clock: () => Date.now(),
  };
}

export type Decision =
  | MatchDecision
  | "declined" | "group_conflict" | "person" | "no_posts" | "client_website"
  | "created" | "would_create" | "taken" | "not_read" | "later" | "no_name";

export interface BrandResult {
  /** The brand's smallest profile id, as the next run is asked for it. */
  key: string;
  /** The brand as people know it: the new client's name. */
  brand: string;
  /** How that name was chosen. */
  name_reason: string;
  /** The Sprout group the brand is, or null for profiles in no group. */
  group: CustomerGroup | null;
  profile_ids: string[];
  /** Each profile with the Sprout groups it is in, to check the grouping by. */
  profiles: Array<{ id: string; name: string; network: string; groups: string[] }>;
  decision: Decision;
  reason: string;
  client_id?: string | null;
  client_ids?: string[];
  /** The decision a person recorded not to add the brand (sprout_brand_declines). */
  decline?: Pick<BrandDecline, "id" | "brand" | "declined_at" | "note">;
  posts?: number;
  /** The brands the website search tied into this one, by key. */
  joined?: string[];
  website?: Pick<WebsiteSearch, "website" | "confirmed_by" | "most_linked" | "domains" | "tried">;
}

export interface OnboardingReport {
  dry_run: boolean;
  at: string;
  profiles: number;
  brands: number;
  /** The clients this run made (none in a dry run). */
  created: string[];
  /** The brands left for the next run, by key. */
  left: string[];
  results: BrandResult[];
}

const FACT_WORDS: Record<SiteFact, string> = {
  profile_link: "its homepage links to one of the brand's profiles",
  domain_name: "its domain name is the brand name",
  site_name: "its og:site_name is the brand name",
};

const base = (b: Brand): Pick<BrandResult, "key" | "brand" | "name_reason" | "group" | "profile_ids" | "profiles"> => ({
  key: b.key, brand: b.name, name_reason: b.name_reason, group: b.group, profile_ids: b.profiles.map((p) => String(p.id)),
  profiles: b.profiles.map((p) => ({ id: String(p.id), name: p.name, network: p.network_type, groups: (p.groups ?? []).map(String) })),
});
/** Results in the order of each brand's oldest profile. */
const byId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const resultOrder = (a: BrandResult, b: BrandResult) => byId(a.profile_ids[0] ?? "", b.profile_ids[0] ?? "") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const searchView = (s: WebsiteSearch | null): BrandResult["website"] =>
  s ? { website: s.website, confirmed_by: s.confirmed_by, most_linked: s.most_linked, domains: s.domains.slice(0, 5), tried: s.tried } : undefined;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Every row of a table, a page at a time by its key, so no read is cut at the API's row cap. */
async function readAll(db: Db, table: string, columns: string, key: string, filter: (q: Db) => Db = (q) => q): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (;;) {
    let q = filter(db.from(table).select(columns));
    if (after !== null) q = q.gt(key, after);
    const { data, error } = await q.order(key).limit(PAGE);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    after = String(rows[rows.length - 1][key]);
  }
}

/** Every client, every assignment and removal of a listed profile, and the profiles each client's homepage links to. */
async function readIndex(db: Db, profileIds: number[]): Promise<ClientIndex> {
  const ids = profileIds.length ? profileIds : [-1];
  const [clients, reads, assignedRows, removedRows] = await Promise.all([
    readAll(db, "clients", "id, name, website_url, archived_at, demo_job_id", "id"),
    readAll(db, "client_lifecycle_steps", "client_id, result", "client_id", (q) => q.eq("step", "brand_read")),
    readAll(db, "sprout_profiles", "id, client_id, sprout_profile_id", "id", (q) => q.in("sprout_profile_id", ids)),
    (async () => {
      const { data, error } = await db.from("sprout_profile_removals").select("client_id, sprout_profile_id").in("sprout_profile_id", ids);
      if (error) throw new Error(`Could not read sprout_profile_removals: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    })(),
  ]);
  const links = new Map(reads.map((r) => [String(r.client_id), ((r.result as { site_profiles?: unknown } | null)?.site_profiles as string[] | undefined) ?? []]));
  const byProfile = (rows: Record<string, unknown>[]) => {
    const m = new Map<string, string[]>();
    for (const r of rows) m.set(String(r.sprout_profile_id), [...(m.get(String(r.sprout_profile_id)) ?? []), String(r.client_id)]);
    return m;
  };
  return {
    clients: clients.map((c): KnownClient => ({
      id: String(c.id), name: String(c.name ?? ""), website_url: (c.website_url as string | null) ?? null, archived_at: (c.archived_at as string | null) ?? null,
      demo_job_id: (c.demo_job_id as string | null) ?? null, site_profiles: Array.isArray(links.get(String(c.id))) ? links.get(String(c.id))! : [],
    })),
    assigned: byProfile(assignedRows),
    removed: byProfile(removedRows),
  };
}

/** Every brand a person chose not to add as a client, read once a run. */
async function readDeclines(db: Db): Promise<BrandDecline[]> {
  const rows = await readAll(db, "sprout_brand_declines", "id, sprout_group_id, profile_ids, brand, declined_at, note", "id");
  return rows.map((r) => ({
    id: String(r.id), sprout_group_id: r.sprout_group_id == null ? null : String(r.sprout_group_id),
    profile_ids: Array.isArray(r.profile_ids) ? (r.profile_ids as unknown[]).map(String) : [], brand: String(r.brand ?? ""),
    declined_at: String(r.declined_at ?? ""), note: (r.note as string | null) ?? null,
  }));
}

interface Evaluated {
  brand: Brand;
  posts: number;
  search: WebsiteSearch | null;
}

/**
 * One run: every brand (or only the brands `only` names, a run's rest) with
 * what was done and why. A dry run reads Sprout and the brands' sites the
 * same way and writes nothing.
 */
export async function sproutOnboarding(db: Db, deps: OnboardingDeps, o: { dryRun: boolean; only?: string[] | null }): Promise<OnboardingReport> {
  const started = deps.clock();
  const now = deps.now();
  const [listed, groups] = await Promise.all([deps.profiles(), deps.groups()]);
  const index = await readIndex(db, listed.map((p) => Number(p.id)).filter(Number.isFinite));
  const declines = await readDeclines(db);
  const brands = groupBrands(listed, groups);
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const only = o.only ? new Set(o.only.map(String)) : null;
  const results: BrandResult[] = [];
  const matched = new Map<string, BrandResult>();
  const pending: Brand[] = [];

  for (const brand of brands) {
    // Every brand is matched, so a brand of this run that its website ties to a client's brand is that client's.
    // An assigned or removed profile decides first, then a person's decline, then a name or a homepage link.
    const m = matchBrand(brand, index);
    const decline = m && (m.by === "assigned" || m.by === "removed") ? null : declineFor(brand, declines);
    const r = m && !decline ? { ...base(brand), ...matchOutcome(m) } : null;
    if (r) matched.set(brand.key, r);
    if (only && !only.has(brand.key)) continue;
    const conflict = r || decline ? null : groupConflict(brand, groups);
    if (r) {
      results.push(r);
    } else if (decline) {
      results.push({ ...base(brand), decision: "declined", reason: declineReason(decline),
        decline: { id: decline.id, brand: decline.brand, declined_at: decline.declined_at, note: decline.note ?? null } });
    } else if (conflict) {
      results.push({ ...base(brand), decision: "group_conflict", reason: conflict });
    } else if (!brand.name) {
      results.push({ ...base(brand), decision: "no_name", reason: "Left alone: Sprout gives its profiles no name." });
    } else if (!isBrandAccount(brand)) {
      results.push({ ...base(brand), ...blockedFromCreation(brand, { posts: 0, mostLinked: null }, index.clients)! });
    } else {
      pending.push(brand);
    }
  }

  // The brands that may become clients: their posts and website, within the run's time.
  const evaluated = new Map<string, Evaluated>();
  const left = new Set<string>();
  for (const brand of pending) {
    if (deps.clock() - started >= deps.budgetMs) {
      left.add(brand.key);
      continue;
    }
    try {
      const posts = await deps.posts(brand.profiles.map((p) => String(p.id)), new Date(now.getTime() - POSTS_WINDOW_DAYS * DAY), now);
      evaluated.set(brand.key, { brand, posts: posts.length, search: posts.length ? await searchWebsite(brand, posts, deps.reader) : null });
    } catch (e) {
      results.push({ ...base(brand), decision: "not_read", reason: `Not read: Sprout's posts did not answer (${message(e)}). It is looked at again next run.` });
    }
  }

  // Brands their websites tie together are one brand (section 1): among the brands looked at, the ones left for
  // later and the ones that are clients already; never a brand left alone for its group, a person or one not read.
  const found = [...evaluated.values()].map((e) => ({ key: e.brand.key, website: e.search?.website ?? null, site_profiles: e.search?.site_profiles ?? [] }));
  const joinable = new Set([...evaluated.keys(), ...left, ...matched.keys()]);
  const pairs = websiteJoins(found, brands).filter(([a, b]) => joinable.has(a) && joinable.has(b));
  const created: string[] = [];
  for (const joined of joinBrands(brands, pairs)) {
    const members = joined.members.map((k) => byKey.get(k)!);
    const looked = members.filter((b) => evaluated.has(b.key)).map((b) => evaluated.get(b.key)!);
    if (!looked.length) continue;
    for (const b of members) left.delete(b.key);
    const tie = members.map((b) => matched.get(b.key)).find((r) => r);
    if (tie) {
      // Tied to a brand that already is a client: that client's.
      for (const e of looked) {
        results.push({ ...base(e.brand), decision: tie.decision, client_ids: tie.client_ids, posts: e.posts, website: searchView(e.search),
          reason: `Its website ties it to the Sprout brand ${tie.brand}. ${tie.reason}` });
      }
      continue;
    }
    results.push(await decide(db, joined, members, looked, index, o.dryRun, created));
  }

  for (const key of left) {
    const b = brands.find((x) => x.key === key)!;
    results.push({ ...base(b), decision: "later", reason: o.dryRun ? "Not looked at: the 90 seconds were used. Ask again with these brands as left." : "Left for the next run, a minute from now: this run's 90 seconds were used." });
  }
  results.sort(resultOrder);
  return { dry_run: o.dryRun, at: now.toISOString(), profiles: listed.length, brands: brands.length, created, left: [...left].sort((a, b) => a.length - b.length || (a < b ? -1 : 1)), results };
}

/**
 * Whether an unmatched brand (with any brands its website tied to it)
 * becomes a client, and makes it unless this is a dry run. A client made
 * earlier in the run counts as a client (the index is updated after each),
 * so one brand is never made twice in a run, in a dry run either.
 */
async function decide(db: Db, brand: Brand, members: Brand[], looked: Evaluated[], index: ClientIndex, dryRun: boolean, created: string[]): Promise<BrandResult> {
  const clients = index.clients;
  const posts = looked.reduce((n, e) => n + e.posts, 0);
  const counts = new Map<string, number>();
  for (const e of looked) for (const d of e.search?.domains ?? []) {
    // The report lists hosts; the guard totals a site's hosts together (careers.moburst.com and www.moburst.com are one site).
    const site = siteKeyOf(d.domain) ?? d.domain;
    counts.set(site, (counts.get(site) ?? 0) + d.links);
  }
  const mostLinked = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const confirmed = looked.find((e) => e.search?.website)?.search ?? null;
  const shown = confirmed ?? looked.find((e) => e.search)?.search ?? null;
  const out: BrandResult = { ...base(brand), decision: "created", reason: "", posts, website: searchView(shown), ...(members.length > 1 ? { joined: members.map((b) => b.key) } : {}) };
  const since = matchBrand(brand, index);
  if (since) {
    const m = matchOutcome(since);
    const fresh = since.clients.filter((c) => c.id.startsWith("planned:") || created.includes(c.id)).map((c) => c.name);
    return { ...out, ...m, reason: fresh.length ? `${m.reason} (${fresh.join(" and ")}: a client this run ${dryRun ? "would create" : "created"} just before.)` : m.reason };
  }
  const block = blockedFromCreation(brand, { posts, mostLinked }, clients);
  if (block) return { ...out, ...block };
  const owner = confirmed?.website ? clientWithSite(confirmed.website, clients) : null;
  if (owner) {
    return { ...out, decision: "client_website", client_id: owner.id,
      reason: `Left alone: the website its posts confirm, ${confirmed!.website}, is the website of ${owner.name}, so it is that client's secondary or internal account.` };
  }
  const site = confirmed?.website
    ? `its website ${confirmed.website} (${FACT_WORDS[confirmed.confirmed_by!]})`
    : "no website yet: none of the sites its posts link to is confirmed, and the lifecycle's website step looks again every 7 days";
  const what = `${brand.name} with its ${brand.profiles.length} Sprout ${brand.profiles.length === 1 ? "profile" : "profiles"} and ${site}.`;
  const remember = (id: string) => {
    clients.push({ id, name: brand.name, website_url: confirmed?.website ?? null, archived_at: null, demo_job_id: null, site_profiles: confirmed?.site_profiles ?? [] });
    for (const p of brand.profiles) index.assigned.set(String(p.id), [...(index.assigned.get(String(p.id)) ?? []), id]);
  };
  if (dryRun) {
    remember(`planned:${brand.key}`);
    return { ...out, decision: "would_create", reason: `Would be created: ${what}` };
  }
  const { data, error } = await db.rpc("sprout_onboard_client", {
    // The client goes by the brand's name; its origin keeps Sprout's group label.
    p_name: brand.name, p_website: confirmed?.website ?? null, p_brand: brand.group?.name || brand.name,
    p_profiles: brand.profiles.map((p) => ({ id: String(p.id), name: p.name, native_name: p.native_name, network_type: p.network_type, native_link: p.native_link })),
  });
  if (error) throw new Error(`Could not create the client for ${brand.name}: ${error.message}`);
  const made = (data ?? {}) as { created?: boolean; reason?: string; client_id?: string };
  if (!made.created) {
    return { ...out, decision: "taken", client_id: made.client_id ?? null,
      reason: made.reason === "removed" ? "Not created: a person removed one of its profiles from a client meanwhile." : "Not created: another run assigned one of its profiles meanwhile." };
  }
  created.push(String(made.client_id));
  remember(String(made.client_id));
  return { ...out, decision: "created", client_id: made.client_id ?? null, reason: `Created ${what}` };
}

/** The sprout_onboarding job: a run, and the rest queued a minute later when its time ran out. */
export async function runSproutOnboardingJob(db: Db, job: ScheduledJob, deps: OnboardingDeps): Promise<JobOutcome> {
  const only = Array.isArray(job.payload?.left) ? (job.payload!.left as unknown[]).map(String) : null;
  const report = await sproutOnboarding(db, deps, { dryRun: false, only });
  if (report.left.length) {
    const at = new Date(deps.now().getTime() + 60_000).toISOString();
    const { error } = await db.from("scheduled_jobs").upsert({
      kind: "sprout_onboarding", client_id: null, payload: { left: report.left }, dedupe_key: `sprout_onboarding:rest:${job.id}`, priority: 50, available_at: at,
    }, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (error) throw new Error(`Could not queue the rest of the run: ${error.message}`);
  }
  const n = report.results.length;
  return {
    status: "done",
    reason: `Looked at ${n} Sprout ${n === 1 ? "brand" : "brands"}: ${report.created.length} created${report.left.length ? `, ${report.left.length} left for a run a minute from now` : ""}.`,
    result: report as unknown as Record<string, unknown>,
  };
}
