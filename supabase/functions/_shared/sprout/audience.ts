// supabase/functions/_shared/sprout/audience.ts
//
// Where a client's followers are, and the address a local profile gives, as
// the lifecycle's social_read reads them (spec: docs/superpowers/specs/
// 2026-11-03-onboarding-complete-design.md, sections 1 and 3).
//   * analytics/profiles with lifetime_snapshot.followers_by_country and
//     lifetime_snapshot.followers_by_city, the follower snapshots Sprout's
//     changelog (19 Feb 2025) and Fivetran's connector list. Each profile's
//     newest reading counts, summed across the client's profiles.
//   * network_metadata.address, which Sprout's /metadata/customer gives a
//     Google Business Profile, Yelp or Tripadvisor profile.
// Both shapes are read leniently; the run-scheduled-jobs harness mode
// onboarding_fields_check shows what Sprout sends for one client before
// release. Everything but the request is free of Deno and network imports.

import { defaultSproutCustomerId } from "./customer.ts";
import { sproutAccessToken } from "./profiles.ts";
import { countryCode, textAddresses, type Address } from "../lifecycle/location.ts";

const API_BASE = "https://api.sproutsocial.com/v1";

export const FOLLOWER_LOCATION_METRICS = ["lifetime_snapshot.followers_by_country", "lifetime_snapshot.followers_by_city"];

const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown): number => (v !== null && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** A follower breakdown as a list of places and counts: a map of place to count, or a list of rows naming the place and its count. */
export function followerCounts(value: unknown): Array<{ name: string; count: number }> {
  const out: Array<{ name: string; count: number }> = [];
  if (Array.isArray(value)) {
    for (const r of value) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const name = String(o.key ?? o.name ?? o.city ?? o.country ?? o.dimension ?? "").trim();
      const count = num(o.value ?? o.count ?? o.followers);
      if (name && count) out.push({ name, count });
    }
  } else if (value && typeof value === "object") {
    for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
      const count = num(v);
      if (name.trim() && count) out.push({ name: name.trim(), count });
    }
  }
  return out;
}

export interface FollowerLocations {
  /** Countries by ISO code, most followers first, with each one's share of the followers with a known country. */
  countries: Array<{ country: string; followers: number; share: number }>;
  /** Cities as the networks name them, most followers first. */
  cities: Array<{ name: string; count: number }>;
}

/** The followers' countries and cities: each profile's newest reading of each, summed across profiles. */
// deno-lint-ignore no-explicit-any
export function followerLocations(rows: any[]): FollowerLocations {
  const newest = new Map<string, { date: string; value: unknown }>();
  for (const row of rows ?? []) {
    const profile = String(row?.dimensions?.customer_profile_id ?? row?.customer_profile_id ?? "");
    const dateKey = Object.keys(row?.dimensions ?? {}).find((k) => k.startsWith("reporting_period"));
    const date = String(dateKey ? row.dimensions[dateKey] : "").slice(0, 10);
    for (const metric of FOLLOWER_LOCATION_METRICS) {
      const value = row?.metrics?.[metric];
      if (value == null || !followerCounts(value).length) continue;
      const key = `${profile}|${metric}`;
      const was = newest.get(key);
      if (!was || date > was.date) newest.set(key, { date, value });
    }
  }
  const countries = new Map<string, number>();
  const cities = new Map<string, number>();
  for (const [key, { value }] of newest) {
    if (key.endsWith(FOLLOWER_LOCATION_METRICS[0])) {
      for (const { name, count } of followerCounts(value)) {
        const code = countryCode(name);
        if (code) countries.set(code, (countries.get(code) ?? 0) + count);
      }
    } else {
      for (const { name, count } of followerCounts(value)) cities.set(name, (cities.get(name) ?? 0) + count);
    }
  }
  const total = [...countries.values()].reduce((a, b) => a + b, 0);
  return {
    countries: [...countries].map(([country, followers]) => ({ country, followers, share: total ? Math.round((followers / total) * 100) / 100 : 0 }))
      .sort((a, b) => b.followers - a.followers),
    cities: [...cities].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

/** The follower-location readings of the profiles between two days, from analytics/profiles. */
// deno-lint-ignore no-explicit-any
export async function listFollowerLocations(profileIds: string[], o: { since: Date; until: Date; customerId?: string; fetchImpl?: typeof fetch; token?: () => Promise<string> }): Promise<any[]> {
  const ids = [...new Set(profileIds.map(String).filter((id) => /^\d+$/.test(id)))];
  if (!ids.length) return [];
  const f = o.fetchImpl ?? fetch;
  const token = await (o.token ?? (() => sproutAccessToken(f)))();
  const customer = o.customerId || defaultSproutCustomerId();
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await f(`${API_BASE}/${encodeURIComponent(customer)}/analytics/profiles`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: [`customer_profile_id.eq(${ids.join(", ")})`, `reporting_period.in(${day(o.since)}...${day(o.until)})`],
        metrics: FOLLOWER_LOCATION_METRICS, page, limit: 1000,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 300);
      throw new Error(`Sprout's profile analytics did not answer (${response.status}): ${detail}`);
    }
    const data = await response.json();
    rows.push(...(Array.isArray(data?.data) ? data.data : []));
    if (page >= Number(data?.paging?.total_pages || 1)) break;
  }
  return rows;
}

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

/** The address a local profile's network metadata gives, or null. A one-line address needs a ZIP or a street number, as page text does. */
export function profileAddress(networkMetadata: unknown): Address | null {
  const raw = networkMetadata && typeof networkMetadata === "object" ? (networkMetadata as Record<string, unknown>).address : null;
  if (typeof raw === "string") return textAddresses(raw)[0] ?? null;
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const locality = pick(a, "city", "locality", "town");
  const region = pick(a, "state", "region", "province", "administrative_area", "state_code");
  const country = pick(a, "country", "country_code", "countryCode");
  if (!region && !country) {
    const line = pick(a, "formatted", "formatted_address", "display", "full");
    return line ? textAddresses(line)[0] ?? null : null;
  }
  return { locality, region, country };
}
