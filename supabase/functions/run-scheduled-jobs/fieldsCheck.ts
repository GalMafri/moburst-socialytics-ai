// The harness mode onboarding_fields_check (spec: docs/superpowers/specs/
// 2026-11-03-onboarding-complete-design.md, section "What the code does
// today": the build starts with a dry run that confirms, per network, the
// fields the social read needs and writes nothing).
//
// For one client it asks Sprout's documented endpoints, the way the social
// read asks them, and answers which fields came back:
//   * /metadata/customer: each of the client's profiles, whether Sprout gives
//     it network_metadata and an address, and its keys;
//   * analytics/posts over 30 days with the social read's fields: per
//     network, how many posts carry from.profile_picture;
//   * analytics/profiles over 3 days with lifetime_snapshot.followers_by_country
//     and lifetime_snapshot.followers_by_city: per profile, which came back
//     and in what shape (each metric asked alone when Sprout refuses both).
// Nothing is written, and no model, Apify or Firecrawl call is made. A
// picture's address is shown by its host only.

import { defaultSproutCustomerId } from "../_shared/sprout/customer.ts";
import { sproutAccessToken } from "../_shared/sprout/profiles.ts";
import { OWNED_POST_FIELDS, OWNED_POST_METRICS } from "../_shared/sprout/posts.ts";
import { FOLLOWER_LOCATION_METRICS, followerCounts, profileAddress } from "../_shared/sprout/audience.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const API_BASE = "https://api.sproutsocial.com/v1";
const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

interface Answer {
  ok: boolean;
  status: number;
  rows: Row[];
  detail?: string;
}

const shapeOf = (v: unknown): string => (v === null || v === undefined ? "missing" : Array.isArray(v) ? `list of ${v.length}` : typeof v === "object" ? `map of ${Object.keys(v as object).length}` : typeof v);
const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ""; } };
const pictureOf = (row: Row): string => {
  const v = row?.from?.profile_picture ?? row?.["from.profile_picture"];
  return typeof v === "string" ? v : "";
};

export async function onboardingFieldsCheck(db: Db, clientId: string, o: { fetchImpl?: typeof fetch; token?: () => Promise<string>; now?: Date } = {}): Promise<Record<string, unknown>> {
  const f = o.fetchImpl ?? fetch;
  const now = o.now ?? new Date();
  const { data: client, error } = await db.from("clients").select("id, name, sprout_customer_id").eq("id", clientId).maybeSingle();
  if (error) throw new Error(`Could not read the client: ${error.message}`);
  if (!client) return { error: "No client has that id." };
  const { data: assigned, error: pe } = await db.from("sprout_profiles").select("sprout_profile_id, network_type, native_name").eq("client_id", clientId).eq("is_active", true);
  if (pe) throw new Error(`Could not read the client's social accounts: ${pe.message}`);
  const ids = (assigned ?? []).map((p: Row) => String(p.sprout_profile_id));
  const base = { client: { id: client.id, name: client.name }, at: now.toISOString(), writes: "none" };
  if (!ids.length) return { ...base, profiles: [], note: "The client has no active Sprout profiles." };

  const token = await (o.token ?? (() => sproutAccessToken(f)))();
  const customer = String(client.sprout_customer_id || defaultSproutCustomerId());
  const ask = async (path: string, body?: unknown): Promise<Answer> => {
    const response = await f(`${API_BASE}/${encodeURIComponent(customer)}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).split(token).join("[redacted]").replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 400);
      return { ok: false, status: response.status, rows: [], detail };
    }
    const data = await response.json();
    return { ok: true, status: response.status, rows: Array.isArray(data?.data) ? data.data : [] };
  };
  const filter = `customer_profile_id.eq(${ids.join(", ")})`;

  // 1. The profile list: network metadata and an address.
  const meta = await ask("metadata/customer");
  const listed = new Map(meta.rows.map((p) => [String(p.customer_profile_id), p]));
  const profiles = (assigned ?? []).map((a: Row) => {
    const p = listed.get(String(a.sprout_profile_id)) ?? null;
    const nm = p?.network_metadata;
    return {
      id: String(a.sprout_profile_id), network: a.network_type, handle: a.native_name, listed: !!p,
      fields: p ? Object.keys(p).sort() : [], network_metadata: shapeOf(nm), network_metadata_keys: nm && typeof nm === "object" ? Object.keys(nm).sort() : [],
      address: shapeOf(nm?.address), address_read: !!profileAddress(nm),
    };
  });

  // 2. The posts: the social read's fields, and how many carry the profile picture.
  const posts = await ask("analytics/posts", {
    filters: [filter, `created_time.in(${day(new Date(now.getTime() - 30 * DAY))}T00:00:00...${day(now)}T23:59:59)`],
    fields: OWNED_POST_FIELDS, metrics: OWNED_POST_METRICS, sort: ["created_time:desc"], timezone: "UTC", page: 1, limit: 50,
  });
  const byNetwork: Record<string, { posts: number; with_profile_picture: number; picture_hosts: string[] }> = {};
  for (const r of posts.rows) {
    const n = String(r.network ?? "unknown");
    const e = byNetwork[n] ??= { posts: 0, with_profile_picture: 0, picture_hosts: [] };
    e.posts++;
    const pic = pictureOf(r);
    if (pic) {
      e.with_profile_picture++;
      const host = hostOf(pic);
      if (host && !e.picture_hosts.includes(host)) e.picture_hosts.push(host);
    }
  }
  const rowKeys = [...new Set(posts.rows.flatMap((r) => Object.keys(r)))].sort();

  // 3. The followers' countries and cities: both metrics together, else each alone.
  const followersAsk = (metrics: string[]) => ask("analytics/profiles", {
    filters: [filter, `reporting_period.in(${day(new Date(now.getTime() - 3 * DAY))}...${day(now)})`], metrics, page: 1, limit: 1000,
  });
  const together = await followersAsk(FOLLOWER_LOCATION_METRICS);
  const answers: Record<string, Answer> = together.ok
    ? Object.fromEntries(FOLLOWER_LOCATION_METRICS.map((m) => [m, together]))
    : Object.fromEntries(await Promise.all(FOLLOWER_LOCATION_METRICS.map(async (m) => [m, await followersAsk([m])] as const)));
  const followers = Object.fromEntries(FOLLOWER_LOCATION_METRICS.map((m) => {
    const a = answers[m];
    const perProfile: Record<string, { readings: number; with_value: number; shape: string; entries: number; sample: string[] }> = {};
    for (const r of a.rows) {
      const id = String(r?.dimensions?.customer_profile_id ?? "");
      const e = perProfile[id] ??= { readings: 0, with_value: 0, shape: "missing", entries: 0, sample: [] };
      e.readings++;
      const v = r?.metrics?.[m];
      const counts = followerCounts(v);
      if (counts.length) {
        e.with_value++;
        e.shape = shapeOf(v);
        e.entries = Math.max(e.entries, counts.length);
        if (!e.sample.length) e.sample = counts.slice(0, 3).map((c) => c.name);
      }
    }
    return [m, { asked: together.ok ? "together" : "alone", status: a.status, ok: a.ok, ...(a.detail ? { detail: a.detail } : {}), profiles: perProfile }];
  }));

  const present = (m: string) => Object.values((followers[m] as { profiles: Record<string, { with_value: number }> }).profiles).some((p) => p.with_value > 0);
  return {
    ...base,
    profiles,
    metadata: { status: meta.status, ok: meta.ok, ...(meta.detail ? { detail: meta.detail } : {}) },
    posts: { status: posts.status, ok: posts.ok, ...(posts.detail ? { detail: posts.detail } : {}), read: posts.rows.length, row_fields: rowKeys, by_network: byNetwork },
    followers,
    found: {
      profile_picture: Object.values(byNetwork).some((n) => n.with_profile_picture > 0),
      followers_by_country: present(FOLLOWER_LOCATION_METRICS[0]),
      followers_by_city: present(FOLLOWER_LOCATION_METRICS[1]),
      profile_address: profiles.some((p: { address_read: boolean }) => p.address_read),
    },
  };
}
