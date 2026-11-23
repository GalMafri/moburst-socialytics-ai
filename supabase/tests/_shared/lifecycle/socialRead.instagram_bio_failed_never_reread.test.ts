// QA 22 Nov 2026 (P39-02): an Apify run for the Instagram bio that ended FAILED / TIMED-OUT is kept as a finished read: never asked again.
import { describe, expect, it } from "vitest";
import { runSocialRead, type SocialIO } from "../../../functions/_shared/lifecycle/socialRead";
import { fakeDb, writeClientRpc } from "../../../functions/_shared/lifecycle/fakeDb";
import type { StepRow } from "../../../functions/_shared/lifecycle/policy";

const T0 = new Date("2026-11-08T10:00:00.000Z");
const T1 = new Date("2026-11-15T10:00:00.000Z");
const client = { id: "c1", name: "Kitcaster", website_url: null, field_sources: {}, timezone: "America/Denver", location: { source: "website", timezone: "America/Denver" }, logo_url: "https://x/logo.png" };

function io(now: Date, calls: string[]): SocialIO {
  return {
    now: () => now,
    posts: async () => [],
    followers: async () => [],
    customerProfiles: async () => [],
    image: async () => null,
    instagram: async (_cost, handle) => { calls.push(handle); return { state: "failed", run_id: "run1", status: "TIMED-OUT" }; },
    linkedinPage: async () => { throw new Error("no page"); },
    openaiReady: async () => false,
    brandRead: async () => { throw new Error("not asked"); },
  };
}

describe("social_read's Instagram bio", () => {
  it("asks again on the next look after a run that failed, as the LinkedIn page read does", async () => {
    const db = fakeDb({ clients: [client], sprout_profiles: [{ client_id: "c1", sprout_profile_id: 11, network_type: "fb_instagram_account", native_name: "kitcaster", is_active: true }] }, { lifecycle_write_client: writeClientRpc });
    const calls: string[] = [];
    const first = await runSocialRead(db, client, { rows: new Map() }, io(T0, calls));
    expect(calls).toEqual(["kitcaster"]);
    const row = { step: "social_read", status: "done", result: (first as { result: Record<string, unknown> }).result } as unknown as StepRow;
    await runSocialRead(db, client, { rows: new Map([["social_read", row]]) }, io(T1, calls));
    // A week later the bio is still unread (bio null): the failed run must be asked again.
    expect(calls).toEqual(["kitcaster", "kitcaster"]);
  });
});
