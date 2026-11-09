// @vitest-environment node
// Every request a post makes to Sprout, against the shapes Sprout documents
// (api.sproutsocial.com/docs, read 2 Nov 2026). The answers below are the
// documented example responses, with this account's ids.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDraftPost, draftPostBody, earliestSendTime, mediaTypeOf, profileGroupId, publishingToken, sproutMinute, SproutRefusal, uploadMediaFromUrl } from "../../../functions/_shared/sprout/publishing";

const g = globalThis as { Deno?: unknown };
beforeEach(() => { g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "id", SPROUT_CLIENT_SECRET: "secret" } as Record<string, string>)[k] } }; });
afterEach(() => { delete g.Deno; });

interface Sent { url: string; method: string; headers: Record<string, string>; body: unknown }
function sprout(answer: (url: string) => { status?: number; body: unknown }) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), headers: { ...(init.headers as Record<string, string>) }, body: init.body });
    const a = answer(url);
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}
const NO_WAIT = [0, 0];

describe("the access token (Obtaining JSON Web Token (JWT) Access Token)", () => {
  it("asks with the form-encoded client credentials and organization_id scope", async () => {
    const { sent, fetchImpl } = sprout(() => ({ body: { access_token: "tok", token_type: "Bearer", expires_in: 3600 } }));
    expect(await publishingToken(fetchImpl, NO_WAIT)).toBe("tok");
    expect(sent[0].url).toBe("https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token");
    expect(sent[0].method).toBe("POST");
    expect(sent[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(sent[0].body as URLSearchParams)).toEqual({ client_id: "id", client_secret: "secret", grant_type: "client_credentials", scope: "organization_id" });
  });
});

describe("the profile's group (Customer Profiles Endpoint)", () => {
  it("is the first group the profile is in", async () => {
    const { sent, fetchImpl } = sprout(() => ({ body: { data: [
      { customer_profile_id: 5034995, network_type: "facebook", name: "Moburst", native_name: "moburst", native_id: "1", groups: [1330748] },
      { customer_profile_id: 5719052, network_type: "linkedin_company", name: "Moburst", native_name: "moburst", native_id: "2", groups: [1330748, 2449295] },
    ] } }));
    expect(await profileGroupId(fetchImpl, "1676448", "tok", 5719052, NO_WAIT)).toBe("1330748");
    expect(sent[0].url).toBe("https://api.sproutsocial.com/v1/1676448/metadata/customer");
    expect(sent[0].method).toBe("GET");
    expect(sent[0].headers).toMatchObject({ Authorization: "Bearer tok", Accept: "application/json" });
  });
  it("is none for a profile in no group, or not on the account", async () => {
    const { fetchImpl } = sprout(() => ({ body: { data: [{ customer_profile_id: 1, network_type: "x", groups: [] }] } }));
    expect(await profileGroupId(fetchImpl, "1676448", "tok", 1, NO_WAIT)).toBeNull();
    expect(await profileGroupId(fetchImpl, "1676448", "tok", 2, NO_WAIT)).toBeNull();
  });
});

describe("a file (Simple Media Upload, Link Download)", () => {
  it("is posted as multipart/form-data with a media_url part, and its media_id is read from data[0]", async () => {
    const { sent, fetchImpl } = sprout(() => ({ body: { data: [{ media_id: "565fc90f-dd98-4c84-ab17-6f051fb536ce", expiration_time: "2026-11-09T11:20:16Z" }] } }));
    const url = "https://fixture.supabase.co/storage/v1/object/public/design-finishes/post.png";
    expect(await uploadMediaFromUrl(fetchImpl, "1676448", "tok", url, NO_WAIT)).toEqual({ media_id: "565fc90f-dd98-4c84-ab17-6f051fb536ce", media_type: "PHOTO", expiration_time: "2026-11-09T11:20:16Z" });
    expect(sent[0].url).toBe("https://api.sproutsocial.com/v1/1676448/media/");
    expect(sent[0].method).toBe("POST");
    expect(sent[0].headers.Authorization).toBe("Bearer tok");
    // fetch writes the multipart Content-Type with its boundary; a hand-set one would have none.
    expect(sent[0].headers["Content-Type"]).toBeUndefined();
    const form = sent[0].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()]).toEqual(["media_url"]);
    expect(form.get("media_url")).toBe(url);
  });
  it("is tried again after a 5xx, and a 4xx is final", async () => {
    let calls = 0;
    const { fetchImpl } = sprout(() => (++calls === 1 ? { status: 503, body: {} } : { body: { data: [{ media_id: "m1" }] } }));
    expect((await uploadMediaFromUrl(fetchImpl, "1", "tok", "https://x/a.mp4", NO_WAIT)).media_id).toBe("m1");
    const refused = sprout(() => ({ status: 400, body: { error: "unsupported media" } }));
    await expect(uploadMediaFromUrl(refused.fetchImpl, "1", "tok", "https://x/a.txt", NO_WAIT)).rejects.toMatchObject({ step: "media", status: 400 });
    expect(refused.sent).toHaveLength(1);
  });
  it("takes PHOTO, VIDEO or DOCUMENT as its media_type", () => {
    expect(mediaTypeOf("https://x/a.png")).toBe("PHOTO");
    expect(mediaTypeOf("https://x/a.jpg?w=1")).toBe("PHOTO");
    expect(mediaTypeOf("https://x/a.mp4")).toBe("VIDEO");
    expect(mediaTypeOf("https://x/a.MOV#t")).toBe("VIDEO");
    expect(mediaTypeOf("https://x/deck.pdf")).toBe("DOCUMENT");
  });
});

describe("the send time (delivery.scheduled_times)", () => {
  it("is UTC to the minute, as Sprout rounds it", () => {
    expect(sproutMinute("2026-11-09T23:45:00.000Z")).toBe("2026-11-09T23:45:00Z");
    expect(sproutMinute("2026-11-09T23:45:59.999Z")).toBe("2026-11-09T23:45:00Z");
  });
  it("for Send to Sprout now is the first whole minute at least a minute away", () => {
    expect(earliestSendTime(new Date("2026-11-02T14:00:00.000Z"))).toBe("2026-11-02T14:01:00Z");
    expect(earliestSendTime(new Date("2026-11-02T14:00:01.000Z"))).toBe("2026-11-02T14:02:00Z");
    expect(earliestSendTime(new Date("2026-11-02T14:00:59.000Z"))).toBe("2026-11-02T14:02:00Z");
  });
});

describe("the post (Create Publishing Post)", () => {
  const post = { groupId: "1330748", profileId: 5719052, text: "Copy #Tag", sendAt: "2026-11-09T23:45:00Z", media: [{ media_id: "m1", media_type: "PHOTO" as const }] };

  it("carries the documented fields, as a draft for its time", () => {
    expect(draftPostBody(post)).toEqual({
      group_id: 1330748,
      customer_profile_ids: [5719052],
      is_draft: true,
      text: "Copy #Tag",
      media: [{ media_id: "m1", media_type: "PHOTO" }],
      delivery: { scheduled_times: ["2026-11-09T23:45:00Z"], type: "SCHEDULED" },
    });
    expect(draftPostBody({ ...post, text: "", media: [] })).not.toHaveProperty("media");
  });

  it("is posted as JSON and its id is the profile's publishing_post_id", async () => {
    const { sent, fetchImpl } = sprout(() => ({ body: { data: [{
      post_category: "POST", post_type: "LINKEDIN_COMPANY_UPDATE", customer_profile_id: "5719052", profile_guid: "lipr:1",
      internal: { publishing: {
        publishing_post_id: 4567890, group_id: 1330748, is_draft: true, text: "Copy #Tag",
        perma_link: "https://app.sproutsocial.com/publishing/activity/1234/4567890",
        deliveries: [{ type: "SCHEDULED", delivery_status: "PENDING", scheduled_time: "2026-11-09T23:45:00Z" }],
        media: [{ id: "6789-defg-5678", media_type: "PHOTO" }],
      } },
    }] } }));
    expect(await createDraftPost(fetchImpl, "1676448", "tok", post, NO_WAIT)).toEqual({
      publishingPostId: "4567890",
      permaLink: "https://app.sproutsocial.com/publishing/activity/1234/4567890",
      scheduledTime: "2026-11-09T23:45:00Z",
    });
    expect(sent[0].url).toBe("https://api.sproutsocial.com/v1/1676448/publishing/posts");
    expect(sent[0].method).toBe("POST");
    expect(sent[0].headers).toEqual({ Authorization: "Bearer tok", Accept: "application/json", "Content-Type": "application/json" });
    expect(JSON.parse(String(sent[0].body))).toEqual(draftPostBody(post));
  });

  it("is not counted as made when Sprout dropped the profile", async () => {
    const { fetchImpl } = sprout(() => ({ body: { data: [] } }));
    await expect(createDraftPost(fetchImpl, "1676448", "tok", post, NO_WAIT)).rejects.toBeInstanceOf(SproutRefusal);
  });

  it("is never sent twice after a server error, only after a rate limit", async () => {
    const failing = sprout(() => ({ status: 500, body: { error: "boom" } }));
    await expect(createDraftPost(failing.fetchImpl, "1", "tok", post, NO_WAIT)).rejects.toMatchObject({ step: "post", status: 500 });
    expect(failing.sent).toHaveLength(1);
    let calls = 0;
    const limited = sprout(() => (++calls === 1 ? { status: 429, body: {} } : { body: { data: [{ customer_profile_id: 5719052, internal: { publishing: { publishing_post_id: 9 } } }] } }));
    expect((await createDraftPost(limited.fetchImpl, "1", "tok", post, NO_WAIT)).publishingPostId).toBe("9");
    expect(limited.sent).toHaveLength(2);
  });
});
