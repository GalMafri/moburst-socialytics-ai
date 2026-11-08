// The one display layer (src/lib/display.ts): every stored value a screen
// prints as words goes through it.

import { describe, expect, it } from "vitest";
import {
  clientOriginLine, cleanText, declinedBrandLine, competitiveRunStatus, countryNames, eventName, firstRunSentence, formatDate, formatDateTime, formatRange, sproutDraftLine,
  isRawProfileId, languageNames, locationOrigin, notePointKindName, noteReadLine, noteStateLine, onboardingFacts, platformKey, platformName, profileName, roleName, timelineDetail, timelineKindName, usageStateName,
} from "@/lib/display";
import { isActiveClient } from "@/lib/activeClients";

const BS = String.fromCharCode(92);
const esc = (...hex: string[]) => hex.map((h) => BS + "u" + h).join("");

describe("platform names", () => {
  it("gives one key and one name for every way a source writes a network", () => {
    const cases: Array<[string, string, string]> = [
      ["fb_instagram_account", "instagram", "Instagram"], ["INSTAGRAM", "instagram", "Instagram"], ["linkedin_company", "linkedin", "LinkedIn"],
      ["fb_page", "facebook", "Facebook"], ["FACEBOOK", "facebook", "Facebook"], ["TWITTER", "x", "X"], ["Twitter/X", "x", "X"],
      ["twitter_profile", "x", "X"], ["youtube", "youtube", "YouTube"], ["TikTok", "tiktok", "TikTok"],
    ];
    for (const [raw, key, name] of cases) {
      expect(platformKey(raw), raw).toBe(key);
      expect(platformName(raw), raw).toBe(name);
    }
  });
  it("never prints a raw key for an unknown network", () => {
    expect(platformName("google_my_business")).toBe("Google my business");
    expect(platformName("")).toBe("");
    expect(platformName(null)).toBe("");
  });
});

describe("dates", () => {
  it("words calendar dates on their own day in every time zone", () => {
    expect(formatDate("2026-10-07")).toBe("Oct 7, 2026");
    expect(formatDate("2026-10-07", { timeZone: "Pacific/Honolulu" })).toBe("Oct 7, 2026");
    expect(formatRange({ start: "2026-09-01", end: "2026-09-30" })).toBe("Sep 1, 2026 to Sep 30, 2026");
    expect(formatRange({ start: "2026-09-01T00:00:00Z", end: "2026-09-30" })).toBe("Sep 1, 2026 to Sep 30, 2026");
    expect(formatRange({ start: "2026-09-01" })).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
  it("words a timestamp in the viewer's or the given zone", () => {
    expect(formatDateTime("2026-10-07T07:15:00Z", { timeZone: "America/New_York" })).toBe("Oct 7, 2026, 3:15 AM");
    expect(formatDateTime("2026-11-09T23:45:00Z", { timeZone: "America/New_York", year: false })).toBe("Nov 9, 6:45 PM");
  });
});

describe("countries and languages", () => {
  it("names codes and leaves words alone", () => {
    expect(countryNames("US")).toBe("United States");
    expect(countryNames(["US", "CA"])).toBe("United States, Canada");
    expect(countryNames("US, GB")).toBe("United States, United Kingdom");
    expect(languageNames("en")).toBe("English");
    expect(languageNames(["en", "es"])).toBe("English, Spanish");
    expect(countryNames("United States")).toBe("United States");
    expect(countryNames(null)).toBe("");
  });
});

describe("usage words", () => {
  it("names roles, states, events and timeline kinds", () => {
    expect(roleName("moburst_user")).toBe("Moburst team");
    expect(roleName("admin")).toBe("Admin");
    expect(roleName("client")).toBe("Client");
    expect(usageStateName("logged in, no output")).toBe("Signed in, no work yet");
    expect(usageStateName("habit")).toBe("Regular");
    expect(eventName("competitive_analysis_failed")).toBe("Competitive analysis did not finish");
    expect(eventName("report_run")).toBe("Monthly report");
    expect(eventName("media_video")).toBe("Video made");
    expect(eventName("some_new_event")).toBe("Some new event");
    expect(timelineKindName("run")).toBe("Report");
  });
  it("words a timeline detail and drops paths and codes", () => {
    expect(timelineDetail("run", "social · 12m")).toBe("Monthly report · 12 min");
    expect(timelineDetail("post", "linkedin_company · Carousel · v2")).toBe("LinkedIn · Carousel · version 2");
    expect(timelineDetail("event", "/clients/x/reports · 3.2s · server_failed")).toBe("3.2 sec");
  });
  it("finds no raw key in any event name", () => {
    for (const key of ["page_viewed", "ui_clicked", "competitor_set_confirmed", "post_copy_edit_cancelled", "analysis_timed_out", "competitors_found"]) {
      expect(eventName(key)).not.toMatch(/_/);
    }
  });
});

describe("statuses take the whole competitive row", () => {
  it("holds back a finished run whose sources did not pass, without any screen deciding, and says it is being redone", () => {
    expect(competitiveRunStatus({ status: "complete", report_data: { provider_status: 2 } }, { isStaff: true })).toMatchObject({ state: "held", label: "Being redone" });
  });
});

describe("stored text", () => {
  it("decodes escaped characters the report workflow stored, and nothing else", () => {
    // Stored captions from the 19 Oct proof (Bader Law, NewDay USA), decoded as the proven decoder did.
    expect(cleanText("ATL" + String.fromCharCode(0x2019) + "s Finest " + esc("d83c", "df1f") + "\n\nAngel Reese")).toBe("ATL" + String.fromCharCode(0x2019) + "s Finest " + String.fromCodePoint(0x1f31f) + "\n\nAngel Reese");
    expect(cleanText("Corporate Law" + esc("003e") + " Quant")).toBe("Corporate Law> Quant");
    expect(cleanText("Lawyer for check" + esc("d83e", "dd0d", "d83d", "dc69") + String.fromCharCode(0x200d) + esc("d83d", "dcbc"))).toBe("Lawyer for check" + String.fromCodePoint(0x1f90d, 0x1f469) + String.fromCharCode(0x200d) + String.fromCodePoint(0x1f4bc));
    expect(cleanText("Salt " + esc("0026") + " pepper &amp; more")).toBe("Salt & pepper & more");
  });
  it("keeps a lone surrogate as it was stored, and turns line separators into line breaks", () => {
    expect(cleanText("x" + esc("d83d") + "y")).toBe("x" + esc("d83d") + "y");
    expect(cleanText("one" + String.fromCharCode(0x2028) + "two" + String.fromCharCode(0x2029) + "three")).toBe("one\ntwo\nthree");
    expect(cleanText("plain text, no change")).toBe("plain text, no change");
    expect(cleanText(null)).toBe("");
  });
});

describe("competitor profiles", () => {
  it("names a profile by its display name, its readable handle, or the competitor, never a raw id", () => {
    expect(profileName({ handle: "UC1NZzFAsL5uadlVMaqIqcpg", display_name: "Morgan & Morgan" }, "Morgan & Morgan P.A.")).toBe("Morgan & Morgan");
    expect(profileName({ handle: "UC1NZzFAsL5uadlVMaqIqcpg" }, "Morgan & Morgan P.A.")).toBe("Morgan & Morgan P.A.");
    expect(profileName({ handle: "2965180" }, "Gummicube")).toBe("Gummicube");
    expect(profileName({ handle: "forthepeople" }, "Morgan & Morgan P.A.")).toBe("@forthepeople");
    expect(isRawProfileId("@1761291")).toBe(true);
    expect(isRawProfileId("tinuiti")).toBe(false);
  });
});

describe("schedules and active clients", () => {
  it("states when the first report runs, or nothing", () => {
    expect(firstRunSentence("competitive", "2026-11-07T07:00:00Z", "America/New_York")).toBe("The first competitive analysis runs on Nov 7, 2026.");
    expect(firstRunSentence("monthly", "2026-11-07T07:00:00Z", "UTC", { first: false })).toBe("The next monthly report runs on Nov 7, 2026.");
    expect(firstRunSentence("monthly", null)).toBe("");
  });
  it("defines an active client as one that is not archived", () => {
    expect(isActiveClient({ archived_at: null })).toBe(true);
    expect(isActiveClient({ archived_at: "2026-10-01T00:00:00Z" })).toBe(false);
    expect(isActiveClient(null)).toBe(false);
  });
});

describe("where a client came from", () => {
  it("says a client the Sprout onboarding added was added from Sprout Social, and on which day", () => {
    expect(clientOriginLine({ source: "sprout", brand: "Olo", profile_ids: [7001], at: "2026-11-09T06:01:00Z" })).toBe("Added from Sprout Social on Nov 9, 2026");
  });
  it("says nothing for a client a person made, or an origin it cannot read", () => {
    expect(clientOriginLine(null)).toBe("");
    expect(clientOriginLine({ source: "portal", at: "2026-11-09T06:01:00Z" })).toBe("");
    expect(clientOriginLine({ source: "sprout" })).toBe("Added from Sprout Social");
    expect(clientOriginLine("sprout")).toBe("");
  });
});

describe("client notes", () => {
  it("says in one line where each note stands", () => {
    expect(noteStateLine("reading", 0)).toBe("Reading");
    expect(noteStateLine("learned", 12)).toBe("12 points learned");
    expect(noteStateLine("learned", 1)).toBe("1 point learned");
    expect(noteStateLine("nothing", 0)).toBe("Nothing in this note for the copy");
    // Every point of a learned note removed: nothing of it reaches the copy.
    expect(noteStateLine("learned", 0)).toBe("Nothing in this note for the copy");
  });
  it("names each kind of point as the copy section heads it", () => {
    expect(["avoid", "do", "upcoming", "fact", "other"].map(notePointKindName)).toEqual(["Avoid", "Do", "Coming up", "Facts", "Other"]);
  });
  it("says how much of a long file was read, and nothing for one read whole", () => {
    expect(noteReadLine(512345, 400000)).toBe("About the first 400,000 of 512,345 characters were read.");
    expect(noteReadLine(9000, 400000)).toBe("");
    expect(noteReadLine(null, 400000)).toBe("");
  });
});

describe("a Sprout brand a person chose not to add", () => {
  it("says it was declined as a client, and on which day", () => {
    expect(declinedBrandLine({ brand: "Ai Degree", declined_at: "2026-11-02T12:30:00Z" })).toBe("Declined as a client on Nov 2, 2026");
    expect(declinedBrandLine({ brand: "Ai Degree" })).toBe("Declined as a client");
    expect(declinedBrandLine(null)).toBe("");
  });
});

describe("A post's line in Sprout", () => {
  it("says it was sent as a draft, at its time in the client's zone", () => {
    expect(sproutDraftLine("2026-11-09T23:45:00Z", "America/New_York")).toBe("Sent to Sprout as a draft for Nov 9, 6:45 PM.");
    expect(sproutDraftLine("2026-11-02T14:01:00Z", "Asia/Jerusalem")).toBe("Sent to Sprout as a draft for Nov 2, 4:01 PM.");
  });
  it("says it is not sent yet when it has no time", () => {
    expect(sproutDraftLine(null)).toBe("Not sent to Sprout yet.");
  });
});

describe("what the product read from a client's social profiles (onboarding from social profiles, section 6)", () => {
  const NOW = "2026-11-03T10:00:00.000Z";
  const olo = (over: Record<string, unknown> = {}) => ({ name: "Olo", website_url: null, timezone: "UTC", geo: "", language: "", location: null, field_sources: {}, ...over });
  const social = { step: "social_read", status: "done", done_at: NOW, result: {
    checked_at: NOW, follower_countries: [{ country: "US", followers: 70, share: 0.7 }, { country: "GB", followers: 30, share: 0.3 }],
    languages: [{ language: "en", posts: 9 }, { language: "es", posts: 3 }], language_posts: 12,
  } };
  it("says where the website search looked, and how the website was found", () => {
    const looking = { step: "website", status: "waiting", result: { posts: 214, months: 12, searched_at: NOW, waiting_for: "website" } };
    expect(onboardingFacts(olo(), [looking]).website).toBe("No website found yet. Looked through 214 posts from the last 12 months and searched the web for Olo on Nov 3, 2026.");
    expect(onboardingFacts(olo(), [{ step: "website", status: "waiting", result: { posts: 3, months: 12 } }]).website).toBe("No website found yet. Looked through 3 posts from the last 12 months.");
    const found = (confirmed_by: string, linked_network: string | null = null) => onboardingFacts(olo({ website_url: "https://www.olo.com", field_sources: { website_url: { by: "lifecycle" } } }),
      [{ step: "website", status: "done", result: { website: "https://www.olo.com", confirmed_by, linked_network, found_at: NOW } }]).website;
    expect(found("profile_link", "fb_instagram_account")).toBe("Found on Nov 3, 2026: the site links to the client's Instagram.");
    expect(found("search_profile_link", "linkedin_company")).toBe("Found on Nov 3, 2026: the site links to the client's LinkedIn.");
    expect(found("bio_domain_name")).toBe("Found on Nov 3, 2026: the client's Instagram bio links to it.");
    expect(found("domain_name")).toBe("Found on Nov 3, 2026: the site's domain is the brand's name.");
    expect(found("profile_website", "linkedin_company")).toBe("Found on Nov 3, 2026: the client's LinkedIn page lists it as its website.");
    expect(onboardingFacts(olo({ website_url: "https://www.olo.com", field_sources: { website_url: { by: "person" } } }), []).website).toBe("");
  });
  it("says which profile picture the logo is, and that the website's or an uploaded logo comes first", () => {
    const picture = { logo_url: "https://x/logo-profile-linkedin.png", field_sources: { logo_url: { by: "lifecycle", at: NOW, from: "profile_picture:linkedin" } } };
    expect(onboardingFacts(olo(picture), []).logo).toBe("From the client's LinkedIn profile picture, Nov 3, 2026. The website's logo replaces it once the website is found; a logo you upload is kept.");
    expect(onboardingFacts(olo({ logo_url: "https://olo.com/logo.svg", field_sources: { logo_url: { by: "lifecycle", from: "website" } } }), []).logo).toBe("");
  });
  it("says a logo from the LinkedIn page is the logo on the client's LinkedIn page", () => {
    const page = (website_url: string | null) => olo({ website_url, logo_url: "https://x/logo-linkedin.png", field_sources: { logo_url: { by: "lifecycle", at: NOW, from: "linkedin_page" } } });
    expect(onboardingFacts(page(null), []).logo).toBe("From the logo on the client's LinkedIn page, Nov 3, 2026. The website's logo replaces it once the website is found; a logo you upload is kept.");
    expect(onboardingFacts(page("https://olo.com"), []).logo).toBe("From the logo on the client's LinkedIn page, Nov 3, 2026. A logo you upload is kept.");
    expect(onboardingFacts(olo({ logo_url: "https://x/mine.png", field_sources: { logo_url: { by: "person", at: NOW } } }), []).logo).toBe("");
  });
  it("says where the time zone came from, or that it is not known yet", () => {
    expect(locationOrigin({ source: "profile_address", via: "google_my_business" })).toBe("the address on the client's Google Business Profile");
    expect(locationOrigin({ source: "post_text" })).toBe("an address in the client's posts");
    expect(locationOrigin({ source: "post_read" })).toBe("where the client's posts say the business is based");
    expect(locationOrigin({ source: "followers", locality: "Austin" })).toBe("where most of the client's followers are (Austin)");
    expect(locationOrigin({ source: "schema.org" })).toBe("the business address the website publishes");
    expect(locationOrigin({ source: "profile_address", via: "linkedin_page", locality: "New York" })).toBe("the address on the client's LinkedIn page");
    expect(locationOrigin({ source: "agency" })).toBe("the time zone most of the agency's clients use, until the client's own location is found");
    expect(onboardingFacts(olo({ timezone: "America/New_York", location: { source: "profile_address", via: "linkedin_page", locality: "New York" }, field_sources: { timezone: { by: "lifecycle", from: "profile_address" } } }), [social]).timezone)
      .toBe("Worked out from the address on the client's LinkedIn page. You can change it here.");
    expect(onboardingFacts(olo({ timezone: "America/New_York", location: { source: "agency", country: null }, field_sources: { timezone: { by: "lifecycle", from: "agency" } } }), [social]).timezone)
      .toBe("Worked out from the time zone most of the agency's clients use, until the client's own location is found. You can change it here.");
    expect(onboardingFacts(olo(), [social]).timezone).toBe("Not known yet: no address or location in the client's profiles or posts. Calendar times show in UTC until then.");
    expect(onboardingFacts(olo({ timezone: "America/Chicago", location: { source: "followers", locality: "Austin" }, field_sources: { timezone: { by: "lifecycle" } } }), [social]).timezone)
      .toBe("Worked out from where most of the client's followers are (Austin). You can change it here.");
    expect(onboardingFacts(olo({ timezone: "America/Chicago", field_sources: { timezone: { by: "person" } } }), [social]).timezone).toBe("");
    expect(onboardingFacts(olo(), []).timezone).toBe("");
  });
  it("says where the regions and languages came from, with the counts", () => {
    const f = onboardingFacts(olo({ geo: "US,GB", language: "en,es", field_sources: { geo: { by: "lifecycle", from: "followers" }, language: { by: "lifecycle", from: "posts" } } }), [social]);
    expect(f.regions).toBe("From where the client's followers are: United States 70%, United Kingdom 30%.");
    expect(f.languages).toBe("From the client's posts: English in 9 of 12, Spanish in 3 of 12.");
  });
  it("says the brief was drafted from the posts, or how many posts with text it waits for", () => {
    expect(onboardingFacts(olo({ brief_text: "Drafted from the client's posts on 2026-11-03:\n\nOlo", field_sources: { brief_text: { by: "lifecycle", at: NOW, from: "posts" } } }), []).brief)
      .toBe("Drafted from the client's posts on Nov 3, 2026.");
    expect(onboardingFacts(olo(), [{ step: "brief_pillars", status: "waiting", result: { waiting_for: "posts", text_posts: 3 } }]).brief).toBe("Written once the client has 5 posts with text. It has 3.");
  });
  it("names the three competitors chosen, and why tracking has not started, as a plain fact", () => {
    const chosen = { step: "competitors", status: "done", result: { selected: ["Toast", "ChowNow", "Square"], chosen_from: "posts" } };
    expect(onboardingFacts(olo(), [chosen, { step: "tracking", status: "waiting", result: { waiting_for: "client_website" } }]).competitors)
      .toEqual({ names: ["Toast", "ChowNow", "Square"], tracking: "RivalIQ follows companies by their website, so tracking starts once the client's website is found." });
    expect(onboardingFacts(olo({ website_url: "https://olo.com" }), [chosen, { step: "tracking", status: "waiting", result: { waiting_for: "rivaliq_full" } }]).competitors.tracking)
      .toBe("The RivalIQ plan is full. Tracking starts when a place opens.");
    expect(onboardingFacts(olo({ website_url: "https://www.moburst.com/services/organic/podcast-booking/" }), [chosen, { step: "tracking", status: "waiting", result: { waiting_for: "own_site" } }]).competitors.tracking)
      .toBe("RivalIQ follows companies by their website, and the client's website is a page on another client's site, so tracking starts once the client has a site of its own.");
  });
  it("writes every line in plain words, with no step names, statuses or dashes", () => {
    const f = onboardingFacts(olo({ geo: "US,GB", language: "en,es", logo_url: "x", field_sources: { geo: { by: "lifecycle", from: "followers" }, language: { by: "lifecycle", from: "posts" }, logo_url: { by: "lifecycle", at: NOW, from: "profile_picture:instagram" } } }),
      [social, { step: "website", status: "waiting", result: { posts: 5, months: 12, searched_at: NOW } }, { step: "brief_pillars", status: "waiting", result: { waiting_for: "posts", text_posts: 2 } }]);
    // The LinkedIn page's logo and the agency's time zone, worded the same way.
    const g = onboardingFacts(olo({ timezone: "America/New_York", location: { source: "agency" }, logo_url: "x", field_sources: { timezone: { by: "lifecycle", from: "agency" }, logo_url: { by: "lifecycle", at: NOW, from: "linkedin_page" } } }), [social]);
    const h = onboardingFacts(olo({ timezone: "America/New_York", location: { source: "profile_address", via: "linkedin_page" }, field_sources: { timezone: { by: "lifecycle", from: "profile_address" } } }), [social]);
    const text = [f.website, f.logo, f.timezone, f.regions, f.languages, f.brief, f.competitors.tracking, g.logo, g.timezone, h.timezone].join(" ");
    expect(g.logo && g.timezone && h.timezone).toBeTruthy();
    expect(text).not.toMatch(/social_read|brief_pillars|waiting|lifecycle|profile_picture|linkedin_page|profile_address|local business|undefined|null|NaN|\u2014|\u2013/);
    expect(text).not.toMatch(/colour|organis|recognis/);
  });
});
