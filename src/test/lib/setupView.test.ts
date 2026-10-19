import { describe, expect, it, vi } from "vitest";
import { changedColumns, EMPTY_FORM, formFromClient, keywordPhrases, rebaseForm, setByOf } from "@/lib/clientSetupForm";
import { invokeResendable, sendQuietly, writeResendable } from "@/lib/quietSend";
import { locationSourceWords, periodLabel, scheduleLines, timeZoneName } from "@/lib/display";
import { publishProblems } from "../../../supabase/functions/_shared/sprout/publishRules";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const row = {
  id: "c", name: "Bader Law", website_url: "https://baderlaw.com", timezone: "America/New_York", geo: "US", language: "en",
  primary_platforms: ["Instagram", "Facebook"], content_pillars: [{ name: "Injury law", description: "Plain answers", rationale: "From the site" }],
  social_keywords: ["car accident lawyer"], brand_notes: "[VOICE:Bold / Punchy]\nWarm", brand_identity: { primary_color: "#112233" },
  brief_text: "Drafted from the website", media_backend: "higgsfield", design_references: null, posting_rhythm: { Instagram: 3 },
};

describe("a setup save sends only what the person changed", () => {
  it("sends nothing for a form nobody touched", () => {
    const loaded = formFromClient(row);
    expect(changedColumns(loaded, { ...loaded })).toEqual({});
  });

  it("sends the one field changed, as it is stored", () => {
    const loaded = formFromClient(row);
    expect(changedColumns(loaded, { ...loaded, timezone: "America/Chicago" })).toEqual({ timezone: "America/Chicago" });
    expect(changedColumns(loaded, { ...loaded, geo: ["US", "IL"] })).toEqual({ geo: "US,IL" });
    expect(changedColumns(loaded, { ...loaded, brand_voice_preset: "" })).toEqual({ brand_notes: "Warm" });
  });

  it("creates a client with what the person gave, never the old defaults", () => {
    const created = changedColumns(EMPTY_FORM, { ...EMPTY_FORM, name: "Pay The Pyper", website_url: "https://paythepyper.com" });
    expect(created).toEqual({ name: "Pay The Pyper", website_url: "https://paythepyper.com" });
    for (const k of ["timezone", "content_pillars", "primary_platforms", "geo", "language"]) expect(created).not.toHaveProperty(k);
  });

  it("takes the lifecycle's new values under an open form, and keeps every field the person changed", () => {
    const loaded = formFromClient({ ...row, timezone: "", brief_text: "" });
    const edited = { ...loaded, brief_text: "Our own brief" };
    const next = formFromClient({ ...row, timezone: "America/New_York", brief_text: "Drafted from the website" });
    const rebased = rebaseForm(edited, loaded, next);
    expect(rebased.timezone).toBe("America/New_York");
    expect(rebased.brief_text).toBe("Our own brief");
    // Saved against the new baseline, the person's field is all that goes.
    expect(changedColumns(next, rebased)).toEqual({ brief_text: "Our own brief" });
  });

  it("reads keyword phrases split at commas, without repeats", () => {
    expect(keywordPhrases("AI content strategy, performance marketing tips ,ai content strategy", ["Marketing"])).toEqual(["AI content strategy", "performance marketing tips"]);
  });

  it("knows who set a field", () => {
    expect(setByOf({ timezone: { by: "lifecycle" } }, "timezone")).toBe("lifecycle");
    expect(setByOf({ timezone: { by: "person" } }, "timezone")).toBe("person");
    expect(setByOf({}, "timezone")).toBeNull();
  });
});

describe("where the product's values came from, in words", () => {
  it("names the timezone's source and the zone itself", () => {
    expect(locationSourceWords("schema.org")).toBe("the business address the website publishes");
    expect(locationSourceWords("country")).toMatch(/country/);
    expect(locationSourceWords("something_else")).toBe("");
    expect(timeZoneName("America/New_York")).toBe("Eastern Time (New York)");
    expect(timeZoneName("UTC")).toBe("UTC");
  });

  it("says where a schedule stands from its own fields and its latest report, never the scheduler's note", () => {
    expect(periodLabel({ start: "2026-09-01", end: "2026-09-30" })).toBe("Sep 2026");
    expect(periodLabel({ start: "2026-09-03", end: "2026-09-30" })).toBe("Sep 3, 2026 to Sep 30, 2026");
    expect(scheduleLines({ kind: "monthly", active: true, nextRunAt: "2026-11-07T07:15:00Z", latest: { start: "2026-09-01", end: "2026-09-30", ranAt: "2026-10-07T07:20:00Z" }, timeZone: "UTC" }))
      .toEqual(["Last report: Sep 2026, ran Oct 7, 2026.", "The next one runs on Nov 7, 2026."]);
    expect(scheduleLines({ kind: "competitive", active: false, latest: null })).toEqual(["Paused."]);
    expect(scheduleLines({ kind: "competitive", active: true, nextRunAt: "2026-11-07T07:15:00Z", latest: null, timeZone: "UTC" })).toEqual(["The first one runs on Nov 7, 2026."]);
  });
});

describe("a request that does not get through is sent again quietly", () => {
  it("sends again with growing waits while the answer is worth another try", async () => {
    const waits: number[] = [];
    let n = 0;
    const reply = await sendQuietly(async () => (++n < 3 ? { error: new TypeError("Failed to fetch") } : { error: null, data: "ok" }), { wait: async (ms) => { waits.push(ms); } });
    expect(reply).toMatchObject({ error: null, data: "ok" });
    expect(waits).toEqual([1000, 3000]);
  });

  it("does not ask again when the answer would be the same", async () => {
    let n = 0;
    await sendQuietly(async () => { n++; return { error: { context: { status: 409 } } }; }, { wait: async () => {} });
    expect(n).toBe(1);
  });

  it("tells a passing database problem from a refusal", () => {
    expect(writeResendable({ message: "TypeError: Failed to fetch", code: "" })).toBe(true);
    expect(writeResendable({ code: "08006" })).toBe(true);
    expect(writeResendable({ code: "23505" })).toBe(false);
    expect(writeResendable({ code: "42501" })).toBe(false);
    expect(invokeResendable({ context: { status: 500 } })).toBe(false);
    expect(invokeResendable({ context: { status: 500 } }, { idempotent: true })).toBe(true);
    expect(invokeResendable({ context: { status: 503 } })).toBe(true);
  });
});

describe("what a network accepts in a scheduled post", () => {
  const later = "2030-01-01T10:00:00Z";
  it("passes a post Sprout will take", () => {
    expect(publishProblems({ network: "linkedin_company", text: "Hello", mediaUrls: [], sendAt: later })).toEqual([]);
    expect(publishProblems({ network: "fb_instagram_account", text: "Hi #a", mediaUrls: ["https://x/a.png"], sendAt: later })).toEqual([]);
  });

  it("says, as facts about the post, what stops it", () => {
    expect(publishProblems({ network: "twitter", text: "x".repeat(281), mediaUrls: [], sendAt: later })).toEqual(["The copy is 281 characters. X takes up to 280."]);
    expect(publishProblems({ network: "instagram", text: "Hi", mediaUrls: [], sendAt: later })).toEqual(["Instagram posts need an image or a video."]);
    expect(publishProblems({ network: "tiktok", text: "Hi", mediaUrls: ["https://x/a.png"], sendAt: later })).toEqual(["TikTok posts need a video."]);
    expect(publishProblems({ network: "instagram", text: "Hi " + Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), mediaUrls: ["https://x/a.png"], sendAt: later })[0]).toMatch(/31 hashtags/);
    expect(publishProblems({ network: "linkedin", text: "Hi", mediaUrls: ["data:image/png;base64,AA"], sendAt: later })).toEqual(["One of the attached files has no web address Sprout can read."]);
    expect(publishProblems({ network: "linkedin", text: "Hi", mediaUrls: [], sendAt: "2020-01-01T00:00:00Z" })).toEqual(["The time has already passed."]);
  });
});
