// @vitest-environment node
// schedule-sprout-post's whole exchange with Sprout, against Sprout's
// documented answers (api.sproutsocial.com/docs). The post has the shape of
// a planned LinkedIn post with one finished design.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToSprout, type SendRequest, type SentStore } from "./send";

const g = globalThis as { Deno?: unknown };
const DESIGN_URL = "https://fixture.supabase.co/storage/v1/object/public/design-finishes/moburst/option-1.png";

interface Sent { url: string; method: string; headers: Record<string, string>; body: unknown }
function sprout(over: Partial<Record<"token" | "profiles" | "media" | "post", { status?: number; body: unknown }>> = {}) {
  const sent: Sent[] = [];
  const answers = {
    token: { body: { access_token: "tok" } },
    profiles: { body: { data: [{ customer_profile_id: 5719052, network_type: "linkedin_company", name: "Moburst", groups: [1330748] }] } },
    media: { body: { data: [{ media_id: "565fc90f-dd98-4c84-ab17-6f051fb536ce", expiration_time: "2026-11-09T14:00:00Z" }] } },
    post: { body: { data: [{ post_category: "POST", post_type: "LINKEDIN_COMPANY_UPDATE", customer_profile_id: "5719052", internal: { publishing: {
      publishing_post_id: 4567890, group_id: 1330748, is_draft: true, perma_link: "https://app.sproutsocial.com/publishing/activity/1676448/4567890",
      deliveries: [{ type: "SCHEDULED", delivery_status: "PENDING", scheduled_time: "2026-11-09T23:45:00Z" }],
    } } }] } },
    ...over,
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), headers: { ...(init.headers as Record<string, string>) }, body: init.body });
    const step = url.includes("identity.sproutsocial.com") ? "token" : url.endsWith("/metadata/customer") ? "profiles" : url.endsWith("/media/") ? "media" : url.endsWith("/publishing/posts") ? "post" : null;
    const a = step ? answers[step] : { status: 404, body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

function store(already = false) {
  const rows: Record<string, unknown>[] = [];
  const asked: unknown[] = [];
  const s: SentStore = {
    async alreadySent(q) { asked.push(q); return already; },
    async record(row) { rows.push(row); return true; },
  };
  return { rows, asked, s };
}

const request: SendRequest = {
  clientId: "moburst-client",
  reportId: null,
  calendarPostKey: "post:5f0c2a1e-7d3b-4c8e-9a61-2b4d8e9f0c17",
  profile: { rowId: "sp-li", sproutProfileId: 5719052, networkType: "linkedin_company" },
  platform: "LinkedIn",
  text: "Three things we changed in our paid social bidding this quarter.\n\n#PaidMedia #PaidSocial",
  mediaUrls: [DESIGN_URL],
  scheduledTime: "2026-11-09T23:45:00.000Z",
  customerId: "1676448",
  createdBy: "staff-user",
};
const NO_WAIT = { waits: [0, 0] };

beforeEach(() => {
  g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "id", SPROUT_CLIENT_SECRET: "secret" } as Record<string, string>)[k] } };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T14:00:00Z"));
});
afterEach(() => { delete g.Deno; vi.useRealTimers(); });

describe("scheduling a post to Sprout", () => {
  it("asks for a token, the profile's group, uploads the file by its address, makes the draft, and records it", async () => {
    const { sent, fetchImpl } = sprout();
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply.status).toBe(200);
    expect(sent.map((x) => `${x.method} ${x.url}`)).toEqual([
      "POST https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token",
      "GET https://api.sproutsocial.com/v1/1676448/metadata/customer",
      "POST https://api.sproutsocial.com/v1/1676448/media/",
      "POST https://api.sproutsocial.com/v1/1676448/publishing/posts",
    ]);
    expect((sent[2].body as FormData).get("media_url")).toBe(DESIGN_URL);
    expect(JSON.parse(String(sent[3].body))).toEqual({
      group_id: 1330748,
      customer_profile_ids: [5719052],
      is_draft: true,
      text: request.text,
      media: [{ media_id: "565fc90f-dd98-4c84-ab17-6f051fb536ce", media_type: "PHOTO" }],
      delivery: { scheduled_times: ["2026-11-09T23:45:00Z"], type: "SCHEDULED" },
    });
    expect(rows).toEqual([expect.objectContaining({
      client_id: "moburst-client", calendar_post_key: request.calendarPostKey, profile_id: "sp-li",
      sprout_post_id: "4567890", status: "scheduled", scheduled_time: "2026-11-09T23:45:00Z",
    })]);
    expect(reply.body).toMatchObject({ success: true, recorded: true, status: "scheduled", scheduled_time: "2026-11-09T23:45:00Z", sprout_post_id: "4567890", draft: true });
  });

  it("refuses a time less than a minute away and asks Sprout nothing", async () => {
    const { sent, fetchImpl } = sprout();
    const reply = await sendToSprout({ ...request, scheduledTime: "2026-11-02T14:00:30Z" }, store().s, { fetchImpl, ...NO_WAIT });
    expect(reply.status).toBe(422);
    expect(reply.body.problems).toEqual(["The time has already passed."]);
    expect(sent).toHaveLength(0);
  });

  it("does not send a post already sent for the same calendar post and minute", async () => {
    const { sent, fetchImpl } = sprout();
    const { asked, s } = store(true);
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply.body).toMatchObject({ success: true, already: true });
    expect(asked).toEqual([{ clientId: "moburst-client", calendarPostKey: request.calendarPostKey, status: "scheduled", at: "2026-11-09T23:45:00Z" }]);
    expect(sent).toHaveLength(0);
  });

  it("makes no post for a profile in no Sprout group", async () => {
    const { sent, fetchImpl } = sprout({ profiles: { body: { data: [{ customer_profile_id: 5719052, network_type: "linkedin_company", groups: [] }] } } });
    const reply = await sendToSprout(request, store().s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 409, body: { code: "profile_not_in_group" } });
    expect(sent.some((x) => x.url.endsWith("/publishing/posts") || x.url.endsWith("/media/"))).toBe(false);
  });

  it("makes no post when Sprout does not take a file", async () => {
    const { sent, fetchImpl } = sprout({ media: { status: 400, body: { error: "Media content is not a known media type" } } });
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 502, body: { code: "media_not_taken" } });
    expect(sent.some((x) => x.url.endsWith("/publishing/posts"))).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("records nothing when Sprout does not make the post, and asks once", async () => {
    const { sent, fetchImpl } = sprout({ post: { status: 400, body: { error: "group_id is required" } } });
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 500, body: { code: "post_not_made" } });
    expect(sent.filter((x) => x.url.endsWith("/publishing/posts"))).toHaveLength(1);
    expect(rows).toHaveLength(0);
  });
});
