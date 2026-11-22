// QA 22 Nov 2026 (P39-03): when the client's Instagram account changes and the bio read throws, the previous account's bio is kept as the client's.
import { describe, expect, it } from "vitest";
import { runSocialRead, type SocialIO } from "../../../functions/_shared/lifecycle/socialRead";
import { fakeDb, writeClientRpc } from "../../../functions/_shared/lifecycle/fakeDb";
import type { StepRow } from "../../../functions/_shared/lifecycle/policy";

const client = { id: "c1", name: "Acme", website_url: null, field_sources: {}, timezone: "America/Denver", location: { source: "website", timezone: "America/Denver" }, logo_url: "https://x/logo.png" };
const io: SocialIO = {
  now: () => new Date("2026-11-15T10:00:00.000Z"), posts: async () => [], followers: async () => [], customerProfiles: async () => [], image: async () => null,
  instagram: async () => { throw new Error("Apify token refused"); },
  linkedinPage: async () => { throw new Error("no page"); }, openaiKey: async () => null, brandRead: async () => { throw new Error("not asked"); },
};

describe("social_read's Instagram bio for a changed account", () => {
  it("does not keep the old account's bio when the new account's read cannot be made (the LinkedIn page read drops it)", async () => {
    // The account the client had (id 10, @wrongbrand, parked or removed) was replaced by id 11, @acme.
    const db = fakeDb({ clients: [client], sprout_profiles: [{ client_id: "c1", sprout_profile_id: 11, network_type: "fb_instagram_account", native_name: "acme", is_active: true }] }, { lifecycle_write_client: writeClientRpc });
    const prev = { checked_at: "2026-11-08T10:00:00.000Z", instagram: { profile_id: "10", handle: "wrongbrand", key: "10:wrongbrand:", read_at: "2026-11-08T10:00:00.000Z", bio: { biography: "Other brand, Austin TX", links: ["https://wrongbrand.com"] } } };
    const rows = new Map([["social_read", { step: "social_read", status: "done", result: prev } as unknown as StepRow]]);
    const out = await runSocialRead(db, client, { rows }, io);
    const ig = (out as { result: { instagram: { handle: string; bio: unknown } | null } }).result.instagram;
    expect(ig?.bio ?? null).toBeNull();
  });
});
