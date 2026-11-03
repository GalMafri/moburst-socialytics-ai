// @vitest-environment node
// The client's own public profiles, from data (spec: docs/superpowers/specs/
// 2026-11-03-strategy-v2-design.md, section 3): RivalIQ's record first, then
// the homepage; a person's entry never overwritten; a removed profile never
// back.
import { describe, expect, it } from "vitest";
import { desiredProfiles, profilesKey, syncProfiles, type ProfileRow } from "./profiles";
import { fakeDb } from "../lifecycle/fakeDb";

describe("the client's public profiles", () => {
  it("take RivalIQ's record first, then the homepage's one link per platform, or the one named like the brand", () => {
    const got = desiredProfiles({
      rows: [], brand: "Pay The Pyper",
      rivaliq: [{ platform: "instagram", handle: "paythepyper", profile_url: "https://www.instagram.com/paythepyper/" }],
      site: ["instagram:other", "tiktok:paythepyper", "x:pyperhelp", "x:paythepyperapp", "facebook:a", "facebook:b"],
    });
    expect(got).toEqual([
      { platform: "instagram", handle: "paythepyper", url: "https://www.instagram.com/paythepyper/", source: "rivaliq" },
      { platform: "tiktok", handle: "paythepyper", url: "https://www.tiktok.com/@paythepyper", source: "website" },
      { platform: "x", handle: "paythepyperapp", url: "https://x.com/paythepyperapp", source: "website" },
    ]);
  });

  it("never overwrite a person's entry, and never bring back one a person removed", async () => {
    const rows: ProfileRow[] = [
      { platform: "instagram", handle: "mine", url: null, source: "person" },
      { platform: "tiktok", handle: "paythepyper", url: null, source: "removed" },
      { platform: "x", handle: "old", url: null, source: "website" },
    ];
    const desired = desiredProfiles({ rows, brand: "Pay The Pyper", rivaliq: [{ platform: "instagram", handle: "paythepyper" }], site: ["tiktok:paythepyper", "x:paythepyper"] });
    expect(desired.map((r) => [r.platform, r.handle, r.source])).toEqual([["instagram", "mine", "person"], ["tiktok", "paythepyper", "removed"], ["x", "paythepyper", "website"]]);
    const db = fakeDb({ client_public_profiles: rows.map((r) => ({ client_id: "c1", ...r })) });
    expect(await syncProfiles(db, "c1", rows, desired, new Date("2026-11-03T00:00:00Z"))).toBe(1);
    expect(db.tables.client_public_profiles.map((r) => [r.platform, r.handle, r.source])).toEqual([["instagram", "mine", "person"], ["tiktok", "paythepyper", "removed"], ["x", "paythepyper", "website"]]);
    // A removed profile is not in the key: removing one starts a rewrite without it.
    expect(profilesKey(desired)).toBe(profilesKey(desired.filter((r) => r.source !== "removed")));
  });
});
