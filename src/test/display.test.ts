// The one display layer (src/lib/display.ts): every stored value a screen
// prints as words goes through it.

import { describe, expect, it } from "vitest";
import {
  cleanText, competitiveRunStatus, countryNames, eventName, firstRunSentence, formatDate, formatDateTime, formatRange,
  isRawProfileId, languageNames, platformKey, platformName, profileName, roleName, timelineDetail, timelineKindName, usageStateName,
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
  it("holds back a finished run whose sources did not pass, without any screen deciding", () => {
    expect(competitiveRunStatus({ status: "complete", report_data: { provider_status: 2 } }, { isStaff: true }).label).toBe("Held back");
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
