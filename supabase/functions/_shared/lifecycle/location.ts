// supabase/functions/_shared/lifecycle/location.ts
//
// Where a business is, and so its timezone, read from its own website
// (Lital, 19 Oct 2026: a client's timezone is derived from data, never left
// on a UTC default). The order, proven on 19 Oct on Bader Law, Moburst and
// Pay The Pyper:
//   1. schema.org addresses in the page (Bader's site lists eight Georgia offices);
//   2. a street or ZIP address in the page text, the footer first (Moburst's
//      footer); a text address needs a ZIP or a street number, so a city named
//      in a sentence never counts;
//   3. the headquarters the brand research reads from the site, in the same
//      model call that reads the brand (no extra call);
//   4. the country's main zone, the country taken from any of the above, the
//      page's language tag, or the website's country domain.
// With several addresses, the zone most of them share wins; a tie keeps the
// first listed. Page text can carry a store "near you" picked by where the
// page was fetched from, which is why schema.org and the footer come first.
// Free of Deno and network imports so it can be tested.

/** US state or territory: [name, IANA zone of most of its people]. */
const US: Record<string, [string, string]> = {
  AL: ["Alabama", "America/Chicago"], AK: ["Alaska", "America/Anchorage"], AZ: ["Arizona", "America/Phoenix"],
  AR: ["Arkansas", "America/Chicago"], CA: ["California", "America/Los_Angeles"], CO: ["Colorado", "America/Denver"],
  CT: ["Connecticut", "America/New_York"], DE: ["Delaware", "America/New_York"], DC: ["District of Columbia", "America/New_York"],
  FL: ["Florida", "America/New_York"], GA: ["Georgia", "America/New_York"], HI: ["Hawaii", "Pacific/Honolulu"],
  ID: ["Idaho", "America/Boise"], IL: ["Illinois", "America/Chicago"], IN: ["Indiana", "America/Indiana/Indianapolis"],
  IA: ["Iowa", "America/Chicago"], KS: ["Kansas", "America/Chicago"], KY: ["Kentucky", "America/New_York"],
  LA: ["Louisiana", "America/Chicago"], ME: ["Maine", "America/New_York"], MD: ["Maryland", "America/New_York"],
  MA: ["Massachusetts", "America/New_York"], MI: ["Michigan", "America/Detroit"], MN: ["Minnesota", "America/Chicago"],
  MS: ["Mississippi", "America/Chicago"], MO: ["Missouri", "America/Chicago"], MT: ["Montana", "America/Denver"],
  NE: ["Nebraska", "America/Chicago"], NV: ["Nevada", "America/Los_Angeles"], NH: ["New Hampshire", "America/New_York"],
  NJ: ["New Jersey", "America/New_York"], NM: ["New Mexico", "America/Denver"], NY: ["New York", "America/New_York"],
  NC: ["North Carolina", "America/New_York"], ND: ["North Dakota", "America/Chicago"], OH: ["Ohio", "America/New_York"],
  OK: ["Oklahoma", "America/Chicago"], OR: ["Oregon", "America/Los_Angeles"], PA: ["Pennsylvania", "America/New_York"],
  RI: ["Rhode Island", "America/New_York"], SC: ["South Carolina", "America/New_York"], SD: ["South Dakota", "America/Chicago"],
  TN: ["Tennessee", "America/Chicago"], TX: ["Texas", "America/Chicago"], UT: ["Utah", "America/Denver"],
  VT: ["Vermont", "America/New_York"], VA: ["Virginia", "America/New_York"], WA: ["Washington", "America/Los_Angeles"],
  WV: ["West Virginia", "America/New_York"], WI: ["Wisconsin", "America/Chicago"], WY: ["Wyoming", "America/Denver"],
  PR: ["Puerto Rico", "America/Puerto_Rico"], GU: ["Guam", "Pacific/Guam"], VI: ["U.S. Virgin Islands", "America/St_Thomas"],
};
const US_BY_NAME: Record<string, string> = Object.fromEntries(Object.entries(US).map(([k, [n]]) => [n.toLowerCase(), k]));

/** Provinces and states of the other large countries that span several zones. */
const REGIONS: Record<string, Record<string, [string, string]>> = {
  CA: {
    AB: ["Alberta", "America/Edmonton"], BC: ["British Columbia", "America/Vancouver"], MB: ["Manitoba", "America/Winnipeg"],
    NB: ["New Brunswick", "America/Moncton"], NL: ["Newfoundland and Labrador", "America/St_Johns"], NS: ["Nova Scotia", "America/Halifax"],
    NT: ["Northwest Territories", "America/Yellowknife"], NU: ["Nunavut", "America/Iqaluit"], ON: ["Ontario", "America/Toronto"],
    PE: ["Prince Edward Island", "America/Halifax"], QC: ["Quebec", "America/Toronto"], SK: ["Saskatchewan", "America/Regina"],
    YT: ["Yukon", "America/Whitehorse"],
  },
  AU: {
    ACT: ["Australian Capital Territory", "Australia/Sydney"], NSW: ["New South Wales", "Australia/Sydney"], NT: ["Northern Territory", "Australia/Darwin"],
    QLD: ["Queensland", "Australia/Brisbane"], SA: ["South Australia", "Australia/Adelaide"], TAS: ["Tasmania", "Australia/Hobart"],
    VIC: ["Victoria", "Australia/Melbourne"], WA: ["Western Australia", "Australia/Perth"],
  },
};

/** ISO 3166-1 alpha-2 country: [English name, the zone most of its people live in]. */
const COUNTRIES: Record<string, [string, string]> = {
  US: ["United States", "America/New_York"], CA: ["Canada", "America/Toronto"], MX: ["Mexico", "America/Mexico_City"],
  BR: ["Brazil", "America/Sao_Paulo"], AR: ["Argentina", "America/Argentina/Buenos_Aires"], CL: ["Chile", "America/Santiago"],
  CO: ["Colombia", "America/Bogota"], PE: ["Peru", "America/Lima"], VE: ["Venezuela", "America/Caracas"], UY: ["Uruguay", "America/Montevideo"],
  EC: ["Ecuador", "America/Guayaquil"], CR: ["Costa Rica", "America/Costa_Rica"], PA: ["Panama", "America/Panama"],
  DO: ["Dominican Republic", "America/Santo_Domingo"], JM: ["Jamaica", "America/Jamaica"], GT: ["Guatemala", "America/Guatemala"],
  GB: ["United Kingdom", "Europe/London"], IE: ["Ireland", "Europe/Dublin"], FR: ["France", "Europe/Paris"], DE: ["Germany", "Europe/Berlin"],
  ES: ["Spain", "Europe/Madrid"], PT: ["Portugal", "Europe/Lisbon"], IT: ["Italy", "Europe/Rome"], NL: ["Netherlands", "Europe/Amsterdam"],
  BE: ["Belgium", "Europe/Brussels"], LU: ["Luxembourg", "Europe/Luxembourg"], CH: ["Switzerland", "Europe/Zurich"], AT: ["Austria", "Europe/Vienna"],
  DK: ["Denmark", "Europe/Copenhagen"], SE: ["Sweden", "Europe/Stockholm"], NO: ["Norway", "Europe/Oslo"], FI: ["Finland", "Europe/Helsinki"],
  IS: ["Iceland", "Atlantic/Reykjavik"], PL: ["Poland", "Europe/Warsaw"], CZ: ["Czech Republic", "Europe/Prague"], SK: ["Slovakia", "Europe/Bratislava"],
  HU: ["Hungary", "Europe/Budapest"], RO: ["Romania", "Europe/Bucharest"], BG: ["Bulgaria", "Europe/Sofia"], GR: ["Greece", "Europe/Athens"],
  CY: ["Cyprus", "Asia/Nicosia"], MT: ["Malta", "Europe/Malta"], HR: ["Croatia", "Europe/Zagreb"], SI: ["Slovenia", "Europe/Ljubljana"],
  RS: ["Serbia", "Europe/Belgrade"], BA: ["Bosnia and Herzegovina", "Europe/Sarajevo"], EE: ["Estonia", "Europe/Tallinn"], LV: ["Latvia", "Europe/Riga"],
  LT: ["Lithuania", "Europe/Vilnius"], UA: ["Ukraine", "Europe/Kyiv"], MD: ["Moldova", "Europe/Chisinau"], BY: ["Belarus", "Europe/Minsk"],
  RU: ["Russia", "Europe/Moscow"], TR: ["Turkey", "Europe/Istanbul"], GE: ["Georgia", "Asia/Tbilisi"], AM: ["Armenia", "Asia/Yerevan"],
  AZ: ["Azerbaijan", "Asia/Baku"], IL: ["Israel", "Asia/Jerusalem"], PS: ["Palestine", "Asia/Hebron"], JO: ["Jordan", "Asia/Amman"],
  LB: ["Lebanon", "Asia/Beirut"], AE: ["United Arab Emirates", "Asia/Dubai"], SA: ["Saudi Arabia", "Asia/Riyadh"], QA: ["Qatar", "Asia/Qatar"],
  KW: ["Kuwait", "Asia/Kuwait"], BH: ["Bahrain", "Asia/Bahrain"], OM: ["Oman", "Asia/Muscat"], EG: ["Egypt", "Africa/Cairo"],
  MA: ["Morocco", "Africa/Casablanca"], TN: ["Tunisia", "Africa/Tunis"], NG: ["Nigeria", "Africa/Lagos"], GH: ["Ghana", "Africa/Accra"],
  KE: ["Kenya", "Africa/Nairobi"], ET: ["Ethiopia", "Africa/Addis_Ababa"], ZA: ["South Africa", "Africa/Johannesburg"], IN: ["India", "Asia/Kolkata"],
  PK: ["Pakistan", "Asia/Karachi"], BD: ["Bangladesh", "Asia/Dhaka"], LK: ["Sri Lanka", "Asia/Colombo"], NP: ["Nepal", "Asia/Kathmandu"],
  CN: ["China", "Asia/Shanghai"], HK: ["Hong Kong", "Asia/Hong_Kong"], TW: ["Taiwan", "Asia/Taipei"], JP: ["Japan", "Asia/Tokyo"],
  KR: ["South Korea", "Asia/Seoul"], SG: ["Singapore", "Asia/Singapore"], MY: ["Malaysia", "Asia/Kuala_Lumpur"], TH: ["Thailand", "Asia/Bangkok"],
  VN: ["Vietnam", "Asia/Ho_Chi_Minh"], PH: ["Philippines", "Asia/Manila"], ID: ["Indonesia", "Asia/Jakarta"], KZ: ["Kazakhstan", "Asia/Almaty"],
  UZ: ["Uzbekistan", "Asia/Tashkent"], AU: ["Australia", "Australia/Sydney"], NZ: ["New Zealand", "Pacific/Auckland"],
};

/** Other ways sites and the research write a country. */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US", "united states of america": "US", "u.s.": "US", "u.s.a.": "US", america: "US",
  uk: "GB", "great britain": "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  holland: "NL", "the netherlands": "NL", czechia: "CZ", "republic of korea": "KR", korea: "KR", uae: "AE", "russian federation": "RU",
  "türkiye": "TR", turkiye: "TR",
};
const COUNTRY_BY_NAME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(COUNTRIES).map(([k, [n]]) => [n.toLowerCase(), k])),
  ...COUNTRY_ALIASES,
};

/** Country domains that are sold as generic names and say nothing about where a business is. */
const GENERIC_CCTLDS = new Set(["io", "co", "ai", "me", "tv", "fm", "ly", "gg", "to", "cc", "ws", "la", "sh", "app", "so", "is", "it", "am", "ag", "vc", "bz", "nu", "tk", "ml"]);

/** A country, as a code or a name, to its ISO alpha-2 code. */
export function countryCode(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.length === 2 && COUNTRIES[upper]) return upper;
  if (upper === "UK") return "GB";
  if (upper.length === 3 && ["USA", "GBR", "CAN", "AUS", "ISR", "DEU", "FRA", "IND"].includes(upper)) {
    return { USA: "US", GBR: "GB", CAN: "CA", AUS: "AU", ISR: "IL", DEU: "DE", FRA: "FR", IND: "IN" }[upper] as string;
  }
  return COUNTRY_BY_NAME[raw.toLowerCase()] ?? null;
}

/** The main zone of a country. */
export function countryZone(code: string | null | undefined): string | null {
  return code ? COUNTRIES[code]?.[1] ?? null : null;
}

/** The country a zone belongs to, for the zones the maps above name. */
const ZONE_COUNTRY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [code, [, zone]] of Object.entries(COUNTRIES)) out[zone] ??= code;
  for (const [, zone] of Object.values(US)) out[zone] ??= "US";
  for (const [country, regions] of Object.entries(REGIONS)) for (const [, zone] of Object.values(regions)) out[zone] ??= country;
  return out;
})();
export function zoneCountry(zone: string | null | undefined): string | null {
  return zone ? ZONE_COUNTRY[zone] ?? null : null;
}

export interface Address {
  locality?: string | null;
  region?: string | null;
  country?: string | null;
}

/** The zone of an address, or null when it does not name a zone exactly. */
export function zoneOf(a: Address): { zone: string; country: string } | null {
  const region = String(a.region ?? "").trim().replace(/\.$/, "");
  const country = countryCode(a.country);
  const st = US[region.toUpperCase()] ? region.toUpperCase() : US_BY_NAME[region.toLowerCase()];
  if (st && (!country || country === "US")) return { zone: US[st][1], country: "US" };
  if (country && REGIONS[country]) {
    const regions = REGIONS[country];
    const key = regions[region.toUpperCase()] ? region.toUpperCase() : Object.keys(regions).find((k) => regions[k][0].toLowerCase() === region.toLowerCase());
    if (key) return { zone: regions[key][1], country };
    // A country of several zones and no region: its main zone is a later, weaker step.
    return null;
  }
  // A single-zone country (or one whose main zone everyone uses) is exact enough.
  if (country && country !== "US") return { zone: COUNTRIES[country][1], country };
  return null;
}

/** schema.org PostalAddress values in JSON-LD and microdata. */
export function schemaAddresses(html: string): Address[] {
  const out: Address[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
    if (types.includes("PostalAddress") || "addressRegion" in o || "addressCountry" in o) {
      const c = o.addressCountry;
      const country = c && typeof c === "object" ? (c as Record<string, unknown>).name ?? (c as Record<string, unknown>).identifier : c;
      out.push({ locality: str(o.addressLocality), region: str(o.addressRegion), country: str(country) });
    }
    Object.values(o).forEach(walk);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* a block that is not valid JSON says nothing */ }
  }
  for (const m of html.matchAll(/itemprop=["']addressRegion["'][^>]*>([^<]+)</gi)) out.push({ region: m[1].trim() });
  return distinct(out);
}

/** A page's visible text, scripts and styles left out. */
export function pageText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, "-").replace(/&#39;|&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ");
}

const ABBR = Object.keys(US).join("|");
const STATE_NAMES = Object.values(US).map(([n]) => n.replace(/\./g, "\\.")).join("|");
// A country written after a street address. A name that is also a US state
// (Georgia) is left out: "12 Peachtree St, Atlanta, Georgia" is in the US.
const COUNTRY_WORDS = [...new Set([...Object.values(COUNTRIES).map(([n]) => n), "UK", "USA", "England"])]
  .filter((n) => n !== "United States" && !US_BY_NAME[n.toLowerCase()]).sort((a, b) => b.length - a.length).join("|");

/**
 * Addresses written out in page text. A ZIP code or a street number is
 * required: "City, ST 12345", "City, State 12345", "12 Main Street, City, ST"
 * and "12 Some Street, City, Country".
 */
export function textAddresses(text: string): Address[] {
  const out: Address[] = [];
  for (const m of text.matchAll(new RegExp(`([A-Z][A-Za-z.' -]{1,30}),\\s*(${ABBR}|${STATE_NAMES})\\.?\\s+(\\d{5})(?:-\\d{4})?\\b`, "g"))) {
    out.push({ locality: m[1].trim().split(" ").slice(-3).join(" "), region: m[2], country: "US" });
  }
  const street = `\\b\\d{1,6}[A-Za-z]? [A-Z0-9][^,]{2,60}?(?:, (?:Suite|Ste\\.?|Unit|Floor|Fl\\.?) [^,]{1,15})?[,.] ?([A-Z][A-Za-z.' -]{1,30}),`;
  for (const m of text.matchAll(new RegExp(`${street} (${ABBR})\\b(?![a-z])`, "g"))) out.push({ locality: m[1].trim(), region: m[2], country: "US" });
  for (const m of text.matchAll(new RegExp(`${street} (${COUNTRY_WORDS})\\b`, "g"))) out.push({ locality: m[1].trim(), country: m[2] });
  return distinct(out);
}

/** Where the footer starts, or -1. */
function footerAt(html: string): number {
  const lower = html.toLowerCase();
  return Math.max(lower.lastIndexOf("<footer"), lower.lastIndexOf('class="footer'), lower.lastIndexOf('id="footer'));
}

/** The page's language tag ("en-US" gives en and US). */
export function htmlLanguage(html: string): { language: string | null; country: string | null } {
  const tag = html.match(/<html[^>]*\blang=["']([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2}))?[^"']*["']/i);
  if (!tag) return { language: null, country: null };
  const region = tag[2] ? tag[2].toUpperCase() : null;
  return { language: tag[1].toLowerCase(), country: region && COUNTRIES[region] ? region : null };
}

/** The country a website's own domain names, when it is a country domain used as one. */
export function domainCountry(website: string | null | undefined): string | null {
  let host = "";
  try { host = new URL(/^https?:\/\//i.test(String(website)) ? String(website) : `https://${website}`).hostname.toLowerCase(); } catch { return null; }
  const tld = host.split(".").pop() ?? "";
  if (tld.length !== 2 || GENERIC_CCTLDS.has(tld)) return null;
  const code = tld === "uk" ? "GB" : tld.toUpperCase();
  return COUNTRIES[code] ? code : null;
}

export type LocationSource = "schema.org" | "page_footer" | "page_text" | "site_read" | "country";
/** How exact each source is: a lower rank replaces a higher one, never the other way round. */
export const SOURCE_RANK: Record<LocationSource, number> = { "schema.org": 1, page_footer: 2, page_text: 3, site_read: 4, country: 5 };

export interface ResolvedLocation {
  timezone: string | null;
  source: LocationSource | null;
  country: string | null;
  region: string | null;
  locality: string | null;
  /** How many of the addresses found agree on the zone. */
  agreeing: number;
  /** How many addresses were found at that step. */
  found: number;
}

/** The zone most addresses share; a tie keeps the first listed. */
function vote(addresses: Address[]): { zone: string; country: string; first: Address; agreeing: number } | null {
  const counts = new Map<string, { n: number; country: string; first: Address }>();
  for (const a of addresses) {
    const z = zoneOf(a);
    if (!z) continue;
    const c = counts.get(z.zone);
    if (c) c.n++;
    else counts.set(z.zone, { n: 1, country: z.country, first: a });
  }
  let best: [string, { n: number; country: string; first: Address }] | null = null;
  for (const entry of counts) if (!best || entry[1].n > best[1].n) best = entry;
  return best ? { zone: best[0], country: best[1].country, first: best[1].first, agreeing: best[1].n } : null;
}

/** The research model's read of where the business is based, from the same call that reads the brand. */
export interface Headquarters {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

/** The location of the business behind a website, by the order at the top of this file. */
export function resolveLocation(html: string, opts: { headquarters?: Headquarters | null; website?: string | null } = {}): ResolvedLocation {
  const none = { timezone: null, source: null, country: null, region: null, locality: null, agreeing: 0, found: 0 };
  const from = (source: LocationSource, list: Address[]): ResolvedLocation | null => {
    const v = vote(list);
    return v ? { timezone: v.zone, source, country: v.country, region: str(v.first.region), locality: str(v.first.locality), agreeing: v.agreeing, found: list.length } : null;
  };
  const schema = schemaAddresses(html);
  const bySchema = from("schema.org", schema);
  if (bySchema) return bySchema;
  const at = footerAt(html);
  const footer = at >= 0 ? textAddresses(pageText(html.slice(at))) : [];
  const byFooter = from("page_footer", footer);
  if (byFooter) return byFooter;
  const text = textAddresses(pageText(html));
  const byText = from("page_text", text);
  if (byText) return byText;
  const hq = opts.headquarters;
  if (hq && (hq.region || hq.country)) {
    const z = zoneOf({ locality: hq.city, region: hq.region, country: hq.country });
    if (z) return { timezone: z.zone, source: "site_read", country: z.country, region: str(hq.region), locality: str(hq.city), agreeing: 1, found: 1 };
  }
  const country = [...schema, ...footer, ...text].map((a) => countryCode(a.country)).find(Boolean)
    ?? countryCode(hq?.country) ?? htmlLanguage(html).country ?? domainCountry(opts.website);
  const zone = countryZone(country);
  return zone ? { ...none, timezone: zone, source: "country", country } : { ...none, country: country ?? null };
}

/** True when a new read should replace the stored one: a different website, or a source at least as exact. */
export function replacesLocation(stored: { source?: string | null; website?: string | null } | null | undefined, next: { source: LocationSource | null; website: string }): boolean {
  if (!next.source) return false;
  if (!stored?.source || stored.website !== next.website) return true;
  const was = SOURCE_RANK[stored.source as LocationSource] ?? 99;
  return SOURCE_RANK[next.source] <= was;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function distinct(list: Address[]): Address[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = `${a.locality ?? ""}|${a.region ?? ""}|${a.country ?? ""}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
