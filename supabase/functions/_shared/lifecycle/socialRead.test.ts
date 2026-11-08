// @vitest-environment node
// The social_read step (spec: docs/superpowers/specs/2026-11-03-onboarding-
// complete-design.md, sections 1 to 3 and 5), on a client added from Sprout
// with no website: Olo-shaped, a LinkedIn page and an Instagram account.
import { describe, expect, it } from "vitest";
import { fakeDb, writeClientRpc } from "./fakeDb";
import type { StepRow } from "./policy";
import type { LinkedInPage } from "../apify/linkedinPage";
import {
  detectLanguage, evidencePosts, imageSize, languageCounts, multipleLabel, pageFill, pickLogo, pictureMayReplaceLogo, postLanguages, pageOf, runSocialRead, snapshotOf,
  socialVersionKey, statedInPosts, textPosts, toSocialPosts, versionMove, type SocialIO, type Snapshot, type SocialPost,
} from "./socialRead";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

/** A PNG header of the given size: enough for the file header read. */
function png(width: number, height = width, seed = 0): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b[31] = seed;
  return b;
}
function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment of 16 bytes, then SOF0 with height and width.
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 0, 0, 0]);
}

const PROFILES = [
  { client_id: "c1", sprout_profile_id: 7, network_type: "linkedin_company", native_name: "olo", is_active: true },
  { client_id: "c1", sprout_profile_id: 8, network_type: "fb_instagram_account", native_name: "olo.hq", is_active: true },
];
const pic = (id: number) => `https://media.sprout.example/profile-${id}.png`;
let n = 0;
/** A Sprout post row as listOwnedPostRows returns it. */
function post(profile: number, days: number, text: string, over: Record<string, unknown> = {}) {
  n++;
  return {
    guid: `g${n}`, customer_profile_id: profile, network: profile === 7 ? "LINKEDIN_COMPANY" : "INSTAGRAM", created_time: ago(days), perma_link: `https://social.example/${n}`,
    text, post_type: profile === 7 ? "LINKEDIN_COMPANY_UPDATE" : "INSTAGRAM_MEDIA", content_category: "PHOTO", from: { profile_picture: pic(profile) },
    metrics: { "lifetime.likes": 10, "lifetime.reactions": 10, "lifetime.comments_count": 1, "lifetime.impressions": 500 }, ...over,
  };
}
const POSTS = () => [
  post(7, 3, "Order ahead and skip the line. Visit us at 12 Main Street, Austin, TX 78701"),
  post(8, 4, "Our new menu is here and it is the best one yet"),
  post(7, 6, "We are hiring engineers for the team in our Austin office"),
  post(8, 9, "Thank you for ordering with us this week, see you soon"),
  post(7, 12, "The restaurant tech you need for your brand and your team", { metrics: { "lifetime.reactions": 90, "lifetime.comments_count": 9, "lifetime.impressions": 5000 } }),
  post(8, 15, "Boosted: order now", { is_boosted: true, metrics: { "lifetime.likes": 900, "lifetime.impressions": 90000 } }),
];

const PAGE = (url: string): LinkedInPage => ({ url, name: "Olo", website: "https://olo.com", about: "Restaurant ordering", tagline: null, specialties: [], industries: [], logo: null, headquarters: null });
const PAGE_LOGO = "https://media.licdn.example/olo-logo-400.png";
const HQ_NY = { line1: "99 Hudson St", city: "New York", region: "NY", postalCode: "10013", country: "US" };
/** A page read that gives the page with these fields. */
const pageRead = (over: Partial<LinkedInPage>) => async (url: string) => ({ state: "read" as const, run_id: "p1", usd: null, page: { ...PAGE(url), ...over } });
/** Other clients of the agency, each with a zone that came from a real source. */
const agencyClients = (zone: string, n: number) => Array.from({ length: n }, (_, i) => ({
  id: `k${i}`, archived_at: null, demo_job_id: null, timezone: zone, field_sources: { timezone: { by: "lifecycle", at: "now", from: "schema.org" } },
}));

function io(over: Partial<SocialIO> = {}, rows: () => Record<string, unknown>[] = POSTS) {
  const calls = { posts: [] as number[], brandRead: 0, instagram: 0, linkedinPage: [] as Array<string | null>, urls: [] as string[], images: [] as string[] };
  const fake: SocialIO = {
    now: () => NOW,
    posts: async (_ids, since) => { calls.posts.push(Math.round((NOW.getTime() - since.getTime()) / DAY)); return rows(); },
    followers: async () => [{ dimensions: { customer_profile_id: 7, "reporting_period.by(day)": "2026-11-02" }, metrics: {
      "lifetime_snapshot.followers_by_country": { US: 70, GB: 25, IL: 5 }, "lifetime_snapshot.followers_by_city": { "Austin, TX": 40, "London, United Kingdom": 20 },
    } }],
    customerProfiles: async () => [],
    image: async (url) => { calls.images.push(url); return url === pic(7) ? png(400) : png(320); },
    instagram: async (handle) => { calls.instagram++; return { state: "read", run_id: "r1", usd: 0.003, bio: { handle, biography: "Restaurant ordering. Austin, Texas", links: ["https://olo.com"], full_name: "Olo", category: null } }; },
    linkedinPage: async (url, runId) => { calls.linkedinPage.push(runId); calls.urls.push(url); return { state: "read", run_id: "p1", usd: 0.004, page: PAGE(url) }; },
    openaiKey: async () => "sk",
    brandRead: async () => { calls.brandRead++; return { identity: { primary_color: "#1a1a1a", secondary_color: "#2b2b2b", accent_color: "#ff5a00", font_family: "Inter", visual_style: "v", logo_description: "l", tone_of_voice: "t", design_elements: "d", background_style: "b" }, stated: { city: "Austin", region: "TX", country: "US" }, languages: ["en"] }; },
    ...over,
  };
  return { fake, calls };
}
const oloClient = (over: Record<string, unknown> = {}) => ({
  id: "c1", name: "Olo", website_url: null, field_sources: {}, timezone: "UTC", geo: "US", language: "en", logo_url: null, brand_identity: null, location: null,
  sprout_customer_id: "1676448", look_since: null, harvested_design_references: [], ...over,
});
const world = (c: Record<string, unknown>) => fakeDb({ clients: [c], sprout_profiles: PROFILES.map((p) => ({ ...p })) }, { lifecycle_write_client: writeClientRpc });
const stepRow = (result: Record<string, unknown>): StepRow => ({ client_id: "c1", step: "social_read", inputs_key: "k", status: "done", attempts: 0, attempted_at: NOW.toISOString(), done_at: NOW.toISOString(), next_attempt_at: null, result, error: null });

describe("posts as the step reads them", () => {
  it("leaves out boosted posts, ads, Stories and posts of profiles not the client's", () => {
    const rows = [...POSTS(), post(8, 2, "Ad", { post_type: "FB_INSTAGRAM_AD_POST" }), post(8, 2, "Story", { post_type: "INSTAGRAM_STORY" }), post(99, 1, "Not ours")];
    const posts = toSocialPosts(rows, PROFILES.map((p) => ({ id: String(p.sprout_profile_id), network_type: p.network_type, native_name: p.native_name })));
    expect(posts).toHaveLength(6);
    expect(textPosts(posts)).toHaveLength(5);
    expect(posts.find((p) => p.boosted)?.text).toBe("Boosted: order now");
    expect(posts[0]).toMatchObject({ platform: "LinkedIn", format: "image", picture: pic(7), language: "en" });
  });
  it("reads each post's language from its script or its common words", () => {
    expect(detectLanguage("We are hiring engineers for the team")).toBe("en");
    expect(detectLanguage("ההזמנה שלכם מוכנה, תודה שבחרתם בנו")).toBe("he");
    expect(detectLanguage("Nuestro menú nuevo es para todos los clientes")).toBe("es");
    expect(detectLanguage("🔥🔥")).toBeNull();
    const posts = ["Order with us and the team", "Our menu is for you and your team", "ההזמנה שלכם מוכנה", "Thank you for the order and the love"].map((text, i) => ({ text, language: detectLanguage(text), hasText: true, boosted: false, id: `p${i}` })) as unknown as SocialPost[];
    expect(languageCounts(posts)).toEqual({ total: 4, languages: [{ language: "en", posts: 3 }, { language: "he", posts: 1 }] });
    expect(postLanguages(languageCounts(posts))).toEqual(["en", "he"]);
  });
});

describe("the logo from the profile pictures", () => {
  it("reads a picture's pixel width from its file header", () => {
    expect(imageSize(png(400, 300))).toMatchObject({ width: 400, height: 300, ext: "png" });
    expect(imageSize(jpeg(720, 720))).toMatchObject({ width: 720, height: 720, ext: "jpg" });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("takes the largest picture, and on a tie the LinkedIn page, then Facebook, Instagram, YouTube, TikTok, X", () => {
    expect(pickLogo([{ platform: "Instagram", width: 320, profileId: "8" }, { platform: "LinkedIn", width: 400, profileId: "7" }])!.platform).toBe("LinkedIn");
    expect(pickLogo([{ platform: "TikTok", width: 400, profileId: "1" }, { platform: "Instagram", width: 400, profileId: "8" }, { platform: "Facebook", width: 400, profileId: "9" }])!.platform).toBe("Facebook");
    expect(pickLogo([])).toBeNull();
  });
  it("never replaces a website's or a person's logo, and replaces an earlier picture", () => {
    expect(pictureMayReplaceLogo({ logo_url: null, field_sources: {} })).toBe(true);
    expect(pictureMayReplaceLogo({ logo_url: "https://olo.com/logo.svg", field_sources: { logo_url: { by: "lifecycle" } } })).toBe(false);
    expect(pictureMayReplaceLogo({ logo_url: "https://olo.com/logo.svg", field_sources: { logo_url: { by: "lifecycle", from: "website" } } })).toBe(false);
    expect(pictureMayReplaceLogo({ logo_url: "https://x/mine.png", field_sources: { logo_url: { by: "person" } } })).toBe(false);
    expect(pictureMayReplaceLogo({ logo_url: "https://x/logo-profile-instagram.png", field_sources: { logo_url: { by: "lifecycle", from: "profile_picture:instagram" } } })).toBe(true);
  });
});

describe("where the posts say the business is", () => {
  it("keeps the model's place only when a post or the bio names its city or country", () => {
    expect(statedInPosts({ city: "Austin", region: "TX", country: "US" }, ["See you in Austin!"])).toEqual({ city: "Austin", region: "TX", country: "US" });
    expect(statedInPosts({ city: "Denver", region: "CO", country: "US" }, ["Proudly made in the USA"])).toEqual({ city: "Denver", region: "CO", country: "US" });
    expect(statedInPosts({ city: "Denver", region: "CO", country: "Canada" }, ["We love our customers"])).toBeNull();
  });
});

describe("the evidence version", () => {
  const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
    at: ago(7), top: ["a", "b", "c", "d", "e"], platforms: { LinkedIn: { posts: 8, median: 10 }, Instagram: { posts: 6, median: 20 } }, languages: ["en"], top_country: "US", picture: "p1", look: null, ...over,
  });
  it("stays for a week with nothing new", () => {
    expect(versionMove(snap(), snap({ at: NOW.toISOString() }), [], NOW)).toBeNull();
  });
  it("moves on its first read and on each trigger", () => {
    expect(versionMove(null, snap(), [], NOW)).toBe("first");
    expect(versionMove(snap(), snap({ top: ["a", "w", "x", "y", "z"] }), [], NOW)).toBe("top_posts");
    expect(versionMove(snap(), snap({ top: ["a", "b", "x", "y", "z"] }), [], NOW)).toBeNull();
    expect(versionMove(snap(), snap({ platforms: { LinkedIn: { posts: 8, median: 10 }, Instagram: { posts: 4, median: 20 } } }), [], NOW)).toBe("platform_minimum");
    expect(versionMove(snap(), snap({ platforms: { LinkedIn: { posts: 8, median: 10 }, Instagram: { posts: 6, median: 20 }, TikTok: { posts: 1, median: 3 } } }), [], NOW)).toBe("posting");
    expect(versionMove(snap(), snap({ platforms: { LinkedIn: { posts: 8, median: 15 }, Instagram: { posts: 6, median: 20 } } }), [], NOW)).toBe("engagement");
    expect(versionMove(snap(), snap({ platforms: { LinkedIn: { posts: 8, median: 14 }, Instagram: { posts: 6, median: 20 } } }), [], NOW)).toBeNull();
    expect(versionMove(snap(), snap({ languages: ["en", "he"] }), [], NOW)).toBe("language");
    expect(versionMove(snap(), snap({ top_country: "GB" }), [], NOW)).toBe("followers");
    expect(versionMove(snap(), snap({ picture: "p2" }), [], NOW)).toBe("picture");
    expect(versionMove(snap(), snap({ look: "2026-10-20" }), [], NOW)).toBe("look");
  });
  it("moves after 28 days with 5 or more new posts, a monthly floor", () => {
    const newPosts = [1, 2, 3, 4, 5].map((d) => ({ publishedAt: ago(d), boosted: false })) as SocialPost[];
    expect(versionMove(snap({ at: ago(29) }), snap(), newPosts, NOW)).toBe("monthly");
    expect(versionMove(snap({ at: ago(20) }), snap(), newPosts, NOW)).toBeNull();
    expect(versionMove(snap({ at: ago(29) }), snap(), newPosts.slice(0, 4), NOW)).toBeNull();
  });
  it("keys the steps after it on a move, and on the first version only for a client with posts alone", () => {
    const rows = (v: number) => new Map([["social_read", stepRow({ checked_at: NOW.toISOString(), version: v })]]);
    expect(socialVersionKey(rows(1), false)).toBe("");
    expect(socialVersionKey(rows(1), true)).toBe("|social:1");
    expect(socialVersionKey(rows(2), false)).toBe("|social:2");
    expect(socialVersionKey(new Map(), true)).toBe("");
  });
});

describe("the posts the brief and pillars read", () => {
  it("labels the top posts with their multiple, then adds the newest", () => {
    expect(multipleLabel(2.4, "carousel")).toBe("2.4x its platform's median for carousels");
    const p = (id: string, text: string) => ({ id, text, hasText: !!text, boosted: false, platform: "Instagram", format: "carousel", publishedAt: ago(5) }) as SocialPost;
    const out = evidencePosts([{ post: p("a", "Top post"), multiple: 2.4 }], [p("a", "Top post"), p("b", "Newer post"), p("c", "")]);
    expect(out).toEqual([
      { id: "P1", platform: "Instagram", format: "carousel", date: ago(5).slice(0, 10), text: "Top post", label: "2.4x its platform's median for carousels", top: true },
      { id: "P2", platform: "Instagram", format: "carousel", date: ago(5).slice(0, 10), text: "Newer post", label: null, top: false },
    ]);
  });
});

describe("runSocialRead", () => {
  it("fills a client with no website from its profiles: logo, brand, time zone, regions and languages, each with its source", async () => {
    const c = oloClient();
    const db = world(c);
    const { fake, calls } = io();
    const out = await runSocialRead(db, c, { rows: new Map() }, fake);
    expect(out).toMatchObject({ status: "done", result: { moved: "first", version: 1, window_days: 90, text_posts: 5, enough: true, model_read: true } });
    expect(calls.posts).toEqual([90]);
    expect(calls.brandRead).toBe(1);
    // The LinkedIn picture is the larger one; it is stored, since network picture addresses expire.
    expect(c.logo_url).toMatch(/^https:\/\/project\.test\/storage\/v1\/object\/public\/generated-media\/c1\/brand\/logo-profile-linkedin-[0-9a-f]{16}\.png$/);
    expect([...db.uploads.keys()].some((k) => k.startsWith("generated-media/c1/brand/logo-profile-linkedin-"))).toBe(true);
    // The address in a post (ZIP and street number) sets the time zone.
    expect(c).toMatchObject({ timezone: "America/Chicago", geo: "US,GB", language: "en", location: { source: "post_text", website: null } });
    expect(c.brand_identity).toMatchObject({ accent_color: "#ff5a00" });
    expect(c.field_sources).toMatchObject({
      logo_url: { by: "lifecycle", from: "profile_picture:linkedin" }, timezone: { from: "post_text" }, geo: { from: "followers" }, language: { from: "posts" }, brand_identity: { from: "posts" },
    });
    const result = (out as { result: Record<string, unknown> }).result;
    expect((result.posts as Array<{ text: string }>).map((p) => p.text)).not.toContain("Boosted: order now");
    expect(result.instagram).toMatchObject({ handle: "olo.hq", bio: { links: ["https://olo.com"] } });
  });

  it("makes no model call and no write in a quiet week, and reads the Instagram bio again only when the profile changed", async () => {
    const c = oloClient();
    const db = world(c);
    const first = io();
    const out = await runSocialRead(db, c, { rows: new Map() }, first.fake);
    const rows = new Map([["social_read", stepRow((out as { result: Record<string, unknown> }).result)]]);
    const writes = db.rpcCalls.length;
    const quiet = io();
    const again = await runSocialRead(db, c, { rows }, quiet.fake);
    expect(again).toMatchObject({ status: "done", result: { moved: null, version: 1 } });
    expect(quiet.calls.brandRead).toBe(0);
    expect(quiet.calls.instagram).toBe(0);
    expect(db.rpcCalls.length).toBe(writes);
    // A new Instagram picture is a changed profile: the bio is read again, and the version moves.
    const changed = io({ image: async (url) => (url === pic(7) ? png(400) : png(320, 320, 9)) });
    const moved = await runSocialRead(db, c, { rows }, changed.fake);
    expect(changed.calls.instagram).toBe(1);
    expect(moved).toMatchObject({ result: { moved: "picture", version: 2 } });
  });

  it("never writes over a person's value, never replaces the website's logo, and makes no model call when nothing it fills is open", async () => {
    const c = oloClient({
      logo_url: "https://olo.com/logo.svg", brand_identity: { primary_color: "#000001" }, timezone: "America/New_York", language: "es",
      location: { source: "schema.org", website: "olo.com", country: "US" },
      field_sources: { logo_url: { by: "lifecycle" }, brand_identity: { by: "lifecycle" }, timezone: { by: "lifecycle" }, language: { by: "person" } },
    });
    const db = world(c);
    const { fake, calls } = io();
    await runSocialRead(db, c, { rows: new Map() }, fake);
    expect(calls.brandRead).toBe(0);
    expect(c).toMatchObject({ logo_url: "https://olo.com/logo.svg", timezone: "America/New_York", language: "es", location: { source: "schema.org" } });
    expect(c.brand_identity).toEqual({ primary_color: "#000001" });
  });

  it("reads 12 months when 90 days hold fewer than 5 posts with text, and says how many it has", async () => {
    const c = oloClient();
    const thin = [post(7, 5, "Only one post with words in it"), post(8, 30, "")];
    const { fake, calls } = io({}, () => thin);
    const out = await runSocialRead(world(c), c, { rows: new Map() }, fake);
    expect(calls.posts).toEqual([90, 365]);
    expect(out).toMatchObject({ status: "done", result: { window_days: 365, text_posts: 1, enough: false } });
  });

  it("uses the followers' city only when the profiles and posts state no location, and writes no UTC below every source", async () => {
    const quiet = [post(7, 3, "We love our customers and the team"), post(8, 4, "Our new menu is for you")];
    // No city holds half the followers: the top follower country's main zone.
    const c = oloClient();
    const { fake } = io({
      brandRead: async () => ({ identity: null, stated: null, languages: [] }),
      followers: async () => [{ dimensions: { customer_profile_id: 7 }, metrics: {
        "lifetime_snapshot.followers_by_country": { US: 70, GB: 30 }, "lifetime_snapshot.followers_by_city": { "Austin, TX": 30, "London, United Kingdom": 30, "Tel Aviv, Israel": 30 },
      } }],
    }, () => quiet);
    await runSocialRead(world(c), c, { rows: new Map() }, fake);
    expect(c).toMatchObject({ timezone: "America/New_York", location: { source: "country", country: "US" } });
    // 40 of 60 known-city followers are in Austin: that zone holds two thirds.
    const d = oloClient();
    const cities = io({
      brandRead: async () => ({ identity: null, stated: null, languages: [] }),
      followers: async () => [{ dimensions: { customer_profile_id: 7 }, metrics: { "lifetime_snapshot.followers_by_city": { "Austin, TX": 40, "London, United Kingdom": 20 } } }],
    }, () => quiet);
    await runSocialRead(world(d), d, { rows: new Map() }, cities.fake);
    expect(d).toMatchObject({ timezone: "America/Chicago", location: { source: "followers", locality: "Austin" } });
    const e = oloClient();
    const none = io({ brandRead: async () => ({ identity: null, stated: null, languages: [] }), followers: async () => [] }, () => quiet);
    await runSocialRead(world(e), e, { rows: new Map() }, none.fake);
    expect(e).toMatchObject({ timezone: "UTC", location: null });
  });

  it("takes a Google Business Profile's address first, and says which profile gave it", async () => {
    const c = oloClient();
    const { fake } = io({ customerProfiles: async () => [{ id: "7", name: "Olo", native_name: "olo", network_type: "google_my_business", native_link: "", status: "active", groups: [], network_metadata: { address: { city: "Denver", state: "CO", country: "US" } } }] });
    await runSocialRead(world(c), c, { rows: new Map() }, fake);
    expect(c).toMatchObject({ timezone: "America/Denver", location: { source: "profile_address", via: "google_my_business", locality: "Denver" } });
  });

  it("waits for the client's social accounts", async () => {
    const c = oloClient();
    const db = fakeDb({ clients: [c], sprout_profiles: [] }, { lifecycle_write_client: writeClientRpc });
    expect(await runSocialRead(db, c, { rows: new Map() }, io().fake)).toEqual({ status: "waiting", reason: "social_accounts" });
  });

  it("keeps an Instagram read that cannot be made quiet, and collects a run still going on the next look", async () => {
    const c = oloClient();
    const db = world(c);
    const pending = io({ instagram: async () => ({ state: "pending", run_id: "r9" }) });
    const out = await runSocialRead(db, c, { rows: new Map() }, pending.fake);
    expect((out as { result: Record<string, unknown> }).result.instagram).toMatchObject({ run_id: "r9", bio: null });
    const rows = new Map([["social_read", stepRow((out as { result: Record<string, unknown> }).result)]]);
    let asked: string | null = "";
    const collect = io({ instagram: async (handle, runId) => { asked = runId; return { state: "read", run_id: "r9", usd: null, bio: { handle, biography: "Austin", links: [], full_name: null, category: null } }; } });
    const next = await runSocialRead(db, c, { rows }, collect.fake);
    expect(asked).toBe("r9");
    expect((next as { result: Record<string, unknown> }).result.instagram).toMatchObject({ bio: { biography: "Austin" } });
    const missing = io({ instagram: async () => { throw new Error("APIFY_API_TOKEN is not set"); } });
    const d = oloClient();
    expect(await runSocialRead(world(d), d, { rows: new Map() }, missing.fake)).toMatchObject({ status: "done", result: { instagram: null } });
  });
});

describe("snapshotOf", () => {
  it("counts each platform's organic posts in 90 days with their median engagement", () => {
    const posts = toSocialPosts(POSTS(), PROFILES.map((p) => ({ id: String(p.sprout_profile_id), network_type: p.network_type, native_name: p.native_name })));
    const s = snapshotOf(posts, NOW, { top: [], languages: ["en"], topCountry: "US", picture: null, look: null });
    expect(s.platforms).toEqual({ Instagram: { posts: 2, median: 11 }, LinkedIn: { posts: 3, median: 11 } });
  });

  it("reads the LinkedIn page of a client with a linkedin_company profile once, and keeps it while the profile is the same", async () => {
    const c = oloClient();
    const db = world(c);
    const first = io();
    const out = await runSocialRead(db, c, { rows: new Map() }, first.fake);
    expect(first.calls.linkedinPage).toEqual([null]);
    expect(first.calls.urls).toEqual(["https://www.linkedin.com/company/olo/"]);
    const result = (out as { result: Record<string, unknown> }).result;
    expect(result.linkedin_page).toMatchObject({ profile_id: "7", key: "7:olo", page: { name: "Olo" } });
    expect(pageOf(result)).toMatchObject({ name: "Olo", website: "https://olo.com" });
    const rows = new Map([["social_read", stepRow(result)]]);
    const quiet = io();
    const again = await runSocialRead(db, c, { rows }, quiet.fake);
    expect(quiet.calls.linkedinPage).toEqual([]);
    expect(pageOf((again as { result: Record<string, unknown> }).result)).toMatchObject({ name: "Olo" });
  });

  it("reads it again after 30 days or when the profile changes", async () => {
    const c = oloClient();
    const db = world(c);
    const out = await runSocialRead(db, c, { rows: new Map() }, io().fake);
    const result = (out as { result: Record<string, unknown> }).result;
    const old = { ...result, linkedin_page: { ...(result.linkedin_page as object), read_at: ago(31) } };
    const stale = io();
    await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(old)]]) }, stale.fake);
    expect(stale.calls.linkedinPage).toEqual([null]);
    const young = { ...result, linkedin_page: { ...(result.linkedin_page as object), read_at: ago(29) } };
    const fresh = io();
    await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(young)]]) }, fresh.fake);
    expect(fresh.calls.linkedinPage).toEqual([]);
    const other = { ...result, linkedin_page: { ...(result.linkedin_page as object), key: "7:olo-old" } };
    const changed = io();
    await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(other)]]) }, changed.fake);
    expect(changed.calls.linkedinPage).toEqual([null]);
  });

  it("a pending page read keeps the run id and changes nothing else; a failed or throwing read keeps the last page", async () => {
    const c = oloClient();
    const db = world(c);
    const pending = io({ linkedinPage: async () => ({ state: "pending", run_id: "p9" }) });
    const out = await runSocialRead(db, c, { rows: new Map() }, pending.fake);
    const first = (out as { result: Record<string, unknown> }).result;
    expect(first.linkedin_page).toMatchObject({ run_id: "p9", page: null, read_at: null });
    expect(first.instagram).toMatchObject({ handle: "olo.hq" });
    let asked: string | null = "";
    const collect = io({ linkedinPage: async (url, runId) => { asked = runId; return { state: "read", run_id: "p9", usd: null, page: PAGE(url) }; } });
    const next = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(first)]]) }, collect.fake);
    expect(asked).toBe("p9");
    expect(pageOf((next as { result: Record<string, unknown> }).result)).toMatchObject({ name: "Olo" });
    const read = (next as { result: Record<string, unknown> }).result;
    const old = { ...read, linkedin_page: { ...(read.linkedin_page as object), read_at: ago(40) } };
    const failed = io({ linkedinPage: async () => ({ state: "failed", run_id: "p10", status: "FAILED" }) });
    const afterFail = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(old)]]) }, failed.fake);
    expect(pageOf((afterFail as { result: Record<string, unknown> }).result)).toMatchObject({ name: "Olo" });
    expect((afterFail as { result: { linkedin_page: Record<string, unknown> } }).result.linkedin_page).toMatchObject({ status: "FAILED" });
    const thrown = io({ linkedinPage: async () => { throw new Error("APIFY_API_TOKEN is not set"); } });
    const afterThrow = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(old)]]) }, thrown.fake);
    expect(pageOf((afterThrow as { result: Record<string, unknown> }).result)).toMatchObject({ name: "Olo" });
    const none = oloClient();
    expect(await runSocialRead(world(none), none, { rows: new Map() }, thrown.fake)).toMatchObject({ status: "done", result: { linkedin_page: null } });
    expect(pageOf(null)).toBeNull();
  });

  it("the page read alone is not a move: a quiet week with a new page returns moved null and the same version", async () => {
    const c = oloClient();
    const db = world(c);
    const out = await runSocialRead(db, c, { rows: new Map() }, io().fake);
    const result = (out as { result: Record<string, unknown> }).result;
    const old = { ...result, linkedin_page: { ...(result.linkedin_page as object), read_at: ago(40), page: null } };
    const writes = db.rpcCalls.length;
    const quiet = io();
    const again = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(old)]]) }, quiet.fake);
    expect(quiet.calls.linkedinPage.length).toBe(1);
    expect(again).toMatchObject({ result: { moved: null, version: 1 } });
    expect(pageOf((again as { result: Record<string, unknown> }).result)).toMatchObject({ name: "Olo" });
    expect(quiet.calls.brandRead).toBe(0);
    expect(db.rpcCalls.length).toBe(writes);
  });

  it("reads a failed or empty page again on the next look", async () => {
    const c = oloClient();
    const db = world(c);
    for (const miss of [{ state: "failed", run_id: "p1", status: "FAILED" }, { state: "read", run_id: "p1", usd: null, page: null }] as const) {
      const failed = io({ linkedinPage: async () => miss });
      const out = await runSocialRead(db, c, { rows: new Map() }, failed.fake);
      const result = (out as { result: Record<string, unknown> }).result;
      expect(result.linkedin_page).toMatchObject({ page: null, read_at: null });
      const next = io();
      const again = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(result)]]) }, next.fake);
      expect(next.calls.linkedinPage.length).toBe(1);
      expect(pageOf((again as { result: Record<string, unknown> }).result)).toMatchObject({ name: "Olo" });
    }
  });

  it("returns no old page after the profile changed and the new read failed or threw", async () => {
    const c = oloClient();
    const db = world(c);
    const out = await runSocialRead(db, c, { rows: new Map() }, io().fake);
    const result = (out as { result: Record<string, unknown> }).result;
    const old = { ...result, linkedin_page: { ...(result.linkedin_page as object), key: "7:olo-old", read_at: ago(1) } };
    expect(pageOf(old)).toMatchObject({ name: "Olo" });
    for (const fake of [
      io({ linkedinPage: async () => ({ state: "failed", run_id: "p2", status: "FAILED" }) }),
      io({ linkedinPage: async () => { throw new Error("boom"); } }),
    ]) {
      const got = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(old)]]) }, fake.fake);
      const r = (got as { result: Record<string, unknown> }).result;
      expect(pageOf(r)).toBeNull();
      expect(r.linkedin_page).toMatchObject({ key: "7:olo", read_at: null });
    }
  });
});

describe("pageFill: what the LinkedIn page and the agency fill when it is missing", () => {
  const NY = "America/New_York";
  const page = (over: Partial<LinkedInPage> = {}) => ({ ...PAGE("https://www.linkedin.com/company/olo/"), ...over });
  const none = { fields: {}, from: {}, logoUrl: null };

  it("offers the page logo only when the client has no logo and the lifecycle may write one", () => {
    const withLogo = page({ logo: { url: PAGE_LOGO, width: 400, height: 400 } });
    expect(pageFill(oloClient(), withLogo, null)).toEqual({ fields: {}, from: { logo_url: "linkedin_page" }, logoUrl: PAGE_LOGO });
    // A person's logo (even an empty one), the website's logo and an earlier profile picture are all kept.
    for (const c of [
      oloClient({ logo_url: "https://x/mine.png", field_sources: { logo_url: { by: "person" } } }),
      oloClient({ logo_url: null, field_sources: { logo_url: { by: "person" } } }),
      oloClient({ logo_url: "https://olo.com/logo.svg", field_sources: { logo_url: { by: "lifecycle", from: "website" } } }),
      oloClient({ logo_url: "https://olo.com/logo.svg", field_sources: { logo_url: { by: "lifecycle" } } }),
      oloClient({ logo_url: "https://x/logo-profile-instagram.png", field_sources: { logo_url: { by: "lifecycle", from: "profile_picture:instagram" } } }),
    ]) expect(pageFill(c, withLogo, null)).toEqual(none);
    expect(pageFill(oloClient(), page(), null)).toEqual(none);
    expect(pageFill(oloClient(), null, null)).toEqual(none);
  });

  it("offers the headquarters as a profile address only where no location is stored, or the agency's, or the page's own", () => {
    const hq = page({ headquarters: HQ_NY });
    expect(pageFill(oloClient(), hq, null)).toEqual({
      fields: { timezone: NY, location: { timezone: NY, source: "profile_address", country: "US", region: "NY", locality: "New York", agreeing: 1, found: 1, website: null, via: "linkedin_page" } },
      from: { timezone: "profile_address" }, logoUrl: null,
    });
    // Any other stored source is kept, however weak (final review: a client whose time zone is filled sees no change).
    const byFollowers = oloClient({ timezone: "America/Chicago", location: { source: "followers", timezone: "America/Chicago", locality: "Austin", website: null }, field_sources: { timezone: { by: "lifecycle", from: "followers" } } });
    expect(pageFill(byFollowers, hq, null)).toEqual(none);
    const byCountry = oloClient({ timezone: "Europe/London", location: { source: "country", timezone: "Europe/London", country: "GB", website: null }, field_sources: { timezone: { by: "lifecycle", from: "country" } } });
    expect(pageFill(byCountry, hq, null)).toEqual(none);
    const byPageText = oloClient({ timezone: "America/Chicago", location: { source: "page_text", timezone: "America/Chicago", website: "olo.com" }, field_sources: { timezone: { by: "lifecycle", from: "page_text" } } });
    expect(pageFill(byPageText, hq, null)).toEqual(none);
    // No location stored, but a zone filled from elsewhere (one written before locations were kept, or with no record): kept too.
    expect(pageFill(oloClient({ timezone: "America/Chicago" }), hq, null)).toEqual(none);
    expect(pageFill(oloClient({ timezone: "America/Chicago", field_sources: { timezone: { by: "lifecycle" } } }), hq, null)).toEqual(none);
    // The website's schema.org address ranks the same, and the site's own words are kept.
    const bySite = oloClient({ timezone: "America/Denver", location: { source: "schema.org", timezone: "America/Denver", website: "olo.com" }, field_sources: { timezone: { by: "lifecycle", from: "schema.org" } } });
    expect(pageFill(bySite, hq, null)).toEqual(none);
    // A Google Business Profile's address ranks the same: kept, so the next move does not change it back.
    const byLocal = oloClient({ timezone: "America/Denver", location: { source: "profile_address", via: "google_my_business", timezone: "America/Denver", website: null }, field_sources: { timezone: { by: "lifecycle", from: "profile_address" } } });
    expect(pageFill(byLocal, hq, null)).toEqual(none);
    // The page's own address read again: written only when it changed.
    const filled = pageFill(oloClient(), hq, null).fields.location as Record<string, unknown>;
    const same = oloClient({ timezone: NY, location: { ...filled, read_at: ago(7) }, field_sources: { timezone: { by: "lifecycle", from: "profile_address" } } });
    expect(pageFill(same, hq, null)).toEqual(none);
    expect(pageFill(same, page({ headquarters: { ...HQ_NY, city: "Denver", region: "CO" } }), null)).toMatchObject({ fields: { timezone: "America/Denver", location: { locality: "Denver" } } });
  });

  it("never gives a person's time zone the page's zone; the location still records the page's address", () => {
    const mine = oloClient({ timezone: "Europe/London", field_sources: { timezone: { by: "person" } } });
    const fill = pageFill(mine, page({ headquarters: HQ_NY }), NY);
    expect(fill.fields.timezone).toBeUndefined();
    expect(fill.from.timezone).toBeUndefined();
    expect(fill.fields.location).toMatchObject({ source: "profile_address", via: "linkedin_page" });
  });

  it("gives the agency's zone only when no source places the client and its zone is UTC or empty and unsourced", () => {
    for (const timezone of ["UTC", null, ""]) {
      expect(pageFill(oloClient({ timezone }), page(), NY)).toEqual({
        fields: { timezone: NY, location: { timezone: NY, source: "agency", country: null, region: null, locality: null, agreeing: 0, found: 0, website: null } },
        from: { timezone: "agency" }, logoUrl: null,
      });
    }
    // Any other source wins: the page's headquarters, a stored location, a zone that has a source.
    expect(pageFill(oloClient(), page({ headquarters: HQ_NY }), "Europe/London").from).toEqual({ timezone: "profile_address" });
    expect(pageFill(oloClient({ location: { source: "country", timezone: "Europe/London", country: "GB", website: null } }), null, NY)).toEqual(none);
    expect(pageFill(oloClient({ timezone: "UTC", field_sources: { timezone: { by: "person" } } }), null, NY)).toEqual(none);
    expect(pageFill(oloClient({ timezone: "America/Chicago", field_sources: { timezone: { by: "lifecycle", from: "post_text" } } }), null, NY)).toEqual(none);
    expect(pageFill(oloClient({ timezone: "America/Chicago" }), null, NY)).toEqual(none);
    expect(pageFill(oloClient(), null, null)).toEqual(none);
    // An earlier agency zone follows the agency; the same zone is not written again.
    const earlier = oloClient({ timezone: NY, location: { source: "agency", timezone: NY, website: null }, field_sources: { timezone: { by: "lifecycle", from: "agency" } } });
    expect(pageFill(earlier, null, "America/Chicago")).toMatchObject({ fields: { timezone: "America/Chicago", location: { source: "agency" } }, from: { timezone: "agency" } });
    expect(pageFill(earlier, null, NY)).toEqual(none);
    // A real source replaces the agency's zone.
    expect(pageFill(earlier, page({ headquarters: { ...HQ_NY, city: "Denver", region: "CO" } }), NY)).toMatchObject({ fields: { timezone: "America/Denver" }, from: { timezone: "profile_address" } });
  });
});

describe("runSocialRead: filling what is missing", () => {
  /** No brand read, no followers and no profile picture; the page logo's file, with each address asked for kept in `seen`. */
  const plain = (seen: string[] = []) => ({
    brandRead: async () => ({ identity: null, stated: null, languages: [] }), followers: async () => [],
    image: async (url: string) => { seen.push(url); return url === PAGE_LOGO ? png(400) : null; },
  });

  it("fills a missing logo and time zone from the page and the agency on a quiet week, without moving the version", async () => {
    const c = oloClient();
    const db = world(c);
    const rows = [post(7, 3, "We love our customers and the team"), post(8, 4, "Our new menu is for you")];
    // The first look: no profile picture, the page read still going, and no other client with a zone.
    const first = await runSocialRead(db, c, { rows: new Map() }, io({ ...plain(), linkedinPage: async () => ({ state: "pending", run_id: "p9" }) }, () => rows).fake);
    const r1 = (first as { result: Record<string, unknown> }).result;
    expect(r1).toMatchObject({ moved: "first", version: 1 });
    expect(c).toMatchObject({ logo_url: null, timezone: "UTC", location: null });
    // The page comes in, and 11 of the agency's clients have New York from a real source; 2 are on UTC with none.
    db.tables.clients.push(...agencyClients("America/New_York", 11), { id: "u1", archived_at: null, demo_job_id: null, timezone: "UTC", field_sources: {} }, { id: "u2", archived_at: null, demo_job_id: null, timezone: "UTC", field_sources: {} });
    const seen: string[] = [];
    const next = io({ ...plain(seen), linkedinPage: pageRead({ logo: { url: PAGE_LOGO, width: 400, height: 400 } }) }, () => rows);
    const second = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(r1)]]) }, next.fake);
    const r2 = (second as { result: Record<string, unknown> }).result;
    expect(r2).toMatchObject({ moved: null, version: 1, version_at: r1.version_at, snapshot: r1.snapshot });
    expect([...(r2.filled as string[])].sort()).toEqual(["location", "logo_url", "timezone"]);
    expect(next.calls.brandRead).toBe(0);
    expect(seen).toContain(PAGE_LOGO);
    expect(c.logo_url).toMatch(/^https:\/\/project\.test\/storage\/v1\/object\/public\/generated-media\/c1\/brand\/logo-linkedin-[0-9a-f]{16}\.png$/);
    expect(c).toMatchObject({ timezone: "America/New_York", location: { source: "agency", timezone: "America/New_York", country: null } });
    expect(c.field_sources).toMatchObject({ logo_url: { by: "lifecycle", from: "linkedin_page" }, timezone: { by: "lifecycle", from: "agency" } });
    // The next quiet look has nothing left to fill: no write.
    const writes = db.rpcCalls.length;
    const third = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow(r2)]]) }, io(plain(), () => rows).fake);
    expect(third).toMatchObject({ result: { moved: null, version: 1, filled: [] } });
    expect(db.rpcCalls.length).toBe(writes);
  });

  it("takes the page's headquarters where no location is stored, and the move's own location only when it ranks higher", async () => {
    // No stored location; the posts give an Austin address; the page gives New York.
    const c = oloClient();
    await runSocialRead(world(c), c, { rows: new Map() }, io({ linkedinPage: pageRead({ headquarters: HQ_NY }) }).fake);
    expect(c).toMatchObject({ timezone: "America/New_York", location: { source: "profile_address", via: "linkedin_page", locality: "New York", website: null } });
    expect(c.field_sources).toMatchObject({ timezone: { by: "lifecycle", from: "profile_address" } });
    // A headquarters that names only a country of several zones ranks below the posts' address: the move's own location wins.
    const d = oloClient();
    await runSocialRead(world(d), d, { rows: new Map() }, io({ linkedinPage: pageRead({ headquarters: { line1: null, city: null, region: null, postalCode: null, country: "CA" } }) }).fake);
    expect(d).toMatchObject({ timezone: "America/Chicago", location: { source: "post_text" } });
    expect(d.field_sources).toMatchObject({ timezone: { from: "post_text" } });
    // The website's schema.org address is kept.
    const e = oloClient({ timezone: "America/Denver", location: { source: "schema.org", timezone: "America/Denver", website: "olo.com", country: "US" }, field_sources: { timezone: { by: "lifecycle", from: "schema.org" } } });
    await runSocialRead(world(e), e, { rows: new Map() }, io({ linkedinPage: pageRead({ headquarters: HQ_NY }) }).fake);
    expect(e).toMatchObject({ timezone: "America/Denver", location: { source: "schema.org", website: "olo.com" } });
    // A Google Business Profile's address ranks the same as the page's: the move's own wins, and the next look keeps it.
    const f = oloClient();
    const db = world(f);
    const gmb = async () => [{ id: "7", name: "Olo", native_name: "olo", network_type: "google_my_business", native_link: "", status: "active", groups: [], network_metadata: { address: { city: "Denver", state: "CO", country: "US" } } }];
    const out = await runSocialRead(db, f, { rows: new Map() }, io({ customerProfiles: gmb, linkedinPage: pageRead({ headquarters: HQ_NY }) }).fake);
    expect(f).toMatchObject({ timezone: "America/Denver", location: { source: "profile_address", via: "google_my_business" } });
    const writes = db.rpcCalls.length;
    await runSocialRead(db, f, { rows: new Map([["social_read", stepRow((out as { result: Record<string, unknown> }).result)]]) }, io({ customerProfiles: gmb }).fake);
    expect(db.rpcCalls.length).toBe(writes);
    expect(f).toMatchObject({ timezone: "America/Denver", location: { via: "google_my_business" } });
  });

  it("never moves a client whose location came from the followers or a country to the page's headquarters, on a quiet look or a move (final review)", async () => {
    const rows = [post(7, 3, "We love our customers and the team"), post(8, 4, "Our new menu is for you")];
    for (const stored of [
      { timezone: "America/Chicago", location: { source: "followers", timezone: "America/Chicago", locality: "Austin", region: null, country: "US", website: null }, field_sources: { timezone: { by: "lifecycle", at: "then", from: "followers" } } },
      { timezone: "Europe/London", location: { source: "country", timezone: "Europe/London", country: "GB", region: null, locality: null, website: null }, field_sources: { timezone: { by: "lifecycle", at: "then", from: "country" } } },
    ]) {
      // A move (the first read), then the first look after the page is read: a quiet week.
      const c = oloClient(JSON.parse(JSON.stringify(stored)));
      const db = world(c);
      const first = await runSocialRead(db, c, { rows: new Map() }, io({ ...plain(), linkedinPage: pageRead({ headquarters: HQ_NY }) }, () => rows).fake);
      expect(first).toMatchObject({ result: { moved: "first" } });
      expect(c, stored.location.source).toMatchObject(stored);
      const pending = await runSocialRead(world(c), c, { rows: new Map() }, io({ ...plain(), linkedinPage: async () => ({ state: "pending", run_id: "p9" }) }, () => rows).fake);
      const writes = db.rpcCalls.length;
      const quiet = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow((pending as { result: Record<string, unknown> }).result)]]) }, io({ ...plain(), linkedinPage: pageRead({ headquarters: HQ_NY }) }, () => rows).fake);
      expect(quiet).toMatchObject({ result: { moved: null, filled: [] } });
      expect(db.rpcCalls.length).toBe(writes);
      expect(c, stored.location.source).toMatchObject(stored);
    }
    // An agency zone, or none at all, takes the headquarters on the quiet look.
    for (const before of [{}, { timezone: "America/Chicago", location: { source: "agency", timezone: "America/Chicago", country: null, website: null }, field_sources: { timezone: { by: "lifecycle", from: "agency" } } }]) {
      const c = oloClient(JSON.parse(JSON.stringify(before)));
      const pending = await runSocialRead(world(c), c, { rows: new Map() }, io({ ...plain(), linkedinPage: async () => ({ state: "pending", run_id: "p9" }) }, () => rows).fake);
      await runSocialRead(world(c), c, { rows: new Map([["social_read", stepRow((pending as { result: Record<string, unknown> }).result)]]) }, io({ ...plain(), linkedinPage: pageRead({ headquarters: HQ_NY }) }, () => rows).fake);
      expect(c).toMatchObject({ timezone: "America/New_York", location: { source: "profile_address", via: "linkedin_page" } });
      expect(c.field_sources).toMatchObject({ timezone: { by: "lifecycle", from: "profile_address" } });
    }
  });

  it("never uses the agency's zone while any real source places the client", async () => {
    // The posts give an Austin address.
    const c = oloClient();
    const db = world(c);
    db.tables.clients.push(...agencyClients("America/New_York", 11));
    await runSocialRead(db, c, { rows: new Map() }, io().fake);
    expect(c).toMatchObject({ timezone: "America/Chicago", location: { source: "post_text" } });
    // Only the followers' country is known: its main zone, never the agency's.
    const d = oloClient();
    const other = world(d);
    other.tables.clients.push(...agencyClients("America/New_York", 11));
    const rows = [post(7, 3, "We love our customers and the team"), post(8, 4, "Our new menu is for you")];
    const gb = io({ ...plain(), followers: async () => [{ dimensions: { customer_profile_id: 7 }, metrics: { "lifetime_snapshot.followers_by_country": { GB: 90, US: 10 } } }] }, () => rows);
    await runSocialRead(other, d, { rows: new Map() }, gb.fake);
    expect(d).toMatchObject({ timezone: "Europe/London", location: { source: "country", country: "GB" } });
    expect(d.field_sources).toMatchObject({ timezone: { from: "country" } });
    // Only the model's read of the posts places the client (Denver, named in a post): it outranks the agency's zone.
    const e = oloClient();
    const third = world(e);
    third.tables.clients.push(...agencyClients("America/New_York", 11));
    const said = io({ ...plain(), brandRead: async () => ({ identity: null, stated: { city: "Denver", region: "CO", country: "US" }, languages: [] }) }, () => [post(7, 3, "See you at our Denver launch party"), post(8, 4, "Our new menu is for you")]);
    await runSocialRead(third, e, { rows: new Map() }, said.fake);
    expect(e).toMatchObject({ timezone: "America/Denver", location: { source: "post_read" } });
    expect(e.field_sources).toMatchObject({ timezone: { from: "post_read" } });
  });

  it("never gives the agency's zone on a quiet week when the followers' cities place the client", async () => {
    const c = oloClient();
    const db = world(c);
    const rows = [post(7, 3, "We love our customers and the team"), post(8, 4, "Our new menu is for you")];
    const first = await runSocialRead(db, c, { rows: new Map() }, io(plain(), () => rows).fake);
    db.tables.clients.push(...agencyClients("America/New_York", 11));
    // The followers' cities come in without their countries: not a move, and a real source the next move writes.
    const cities = io({ ...plain(), followers: async () => [{ dimensions: { customer_profile_id: 7 }, metrics: { "lifetime_snapshot.followers_by_city": { "London, United Kingdom": 90 } } }] }, () => rows);
    const writes = db.rpcCalls.length;
    const quiet = await runSocialRead(db, c, { rows: new Map([["social_read", stepRow((first as { result: Record<string, unknown> }).result)]]) }, cities.fake);
    expect(quiet).toMatchObject({ result: { moved: null, filled: [] } });
    expect(db.rpcCalls.length).toBe(writes);
    expect(c).toMatchObject({ timezone: "UTC", location: null });
  });

  it("never gives the page's logo or time zone to a client whose logo or time zone a person set", async () => {
    const c = oloClient({ logo_url: "https://x/mine.png", timezone: "Europe/London", field_sources: { logo_url: { by: "person" }, timezone: { by: "person" } } });
    const db = world(c);
    db.tables.clients.push(...agencyClients("America/New_York", 11));
    const seen: string[] = [];
    const { fake } = io({ ...plain(seen), linkedinPage: pageRead({ logo: { url: PAGE_LOGO, width: 400, height: 400 }, headquarters: HQ_NY }) });
    await runSocialRead(db, c, { rows: new Map() }, fake);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(PAGE_LOGO);
    expect(c).toMatchObject({ logo_url: "https://x/mine.png", timezone: "Europe/London" });
    expect(c.field_sources).toMatchObject({ logo_url: { by: "person" }, timezone: { by: "person" } });
  });

  it("keeps the move's profile picture over the page logo when both are new", async () => {
    const c = oloClient();
    const { fake, calls } = io({ linkedinPage: pageRead({ logo: { url: PAGE_LOGO, width: 400, height: 400 } }) });
    await runSocialRead(world(c), c, { rows: new Map() }, fake);
    expect(calls.images).not.toContain(PAGE_LOGO);
    expect(c.field_sources).toMatchObject({ logo_url: { from: "profile_picture:linkedin" } });
  });
});
