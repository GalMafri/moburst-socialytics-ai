// @vitest-environment node
// schedule-sprout-post's whole exchange with Sprout, against Sprout's
// documented answers (api.sproutsocial.com/docs). The post has the shape of
// a planned LinkedIn post with one finished design.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToSprout, type SendRequest, type SentStore } from "../../functions/schedule-sprout-post/send";

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

/**
 * The scheduled_posts rows the way the table holds them: a row is written as
 * "sending" before Sprout is asked, and one send of a post holds it (the
 * table's one-sending-row-per-post index). `already` is a row a person's
 * earlier send left; `settleFails` makes the last write fail.
 */
function store(already: string | null = null, opts: { settleFails?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const asked: unknown[] = [];
  const s: SentStore = {
    async alreadySent(q) {
      asked.push(q);
      if (already) return already;
      const hit = rows.find((r) => r.calendar_post_key === q.calendarPostKey && r.status === q.status && (!q.at || r.scheduled_time === q.at));
      return hit ? String(hit.scheduled_time) : null;
    },
    async claim(row) {
      if (row.calendar_post_key && rows.some((r) => r.calendar_post_key === row.calendar_post_key && (r.status === "sending" || r.status === "asked" || r.status === "unconfirmed"))) return "taken";
      const id = `row-${rows.length + 1}`;
      rows.push({ id, ...row });
      return { id };
    },
    async settle(id, patch) {
      if (opts.settleFails && patch.status !== "asked") return false;
      Object.assign(rows.find((r) => r.id === id)!, patch);
      return true;
    },
    async drop(id) { rows.splice(rows.findIndex((r) => r.id === id), 1); },
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
      // The design's size, so it is fitted to LinkedIn's limit first (this storage gives none, so it goes as it is).
      `HEAD ${DESIGN_URL}`,
      "POST https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token",
      "GET https://api.sproutsocial.com/v1/1676448/metadata/customer",
      "POST https://api.sproutsocial.com/v1/1676448/media/",
      "POST https://api.sproutsocial.com/v1/1676448/publishing/posts",
    ]);
    expect((sent[3].body as FormData).get("media_url")).toBe(DESIGN_URL);
    expect(JSON.parse(String(sent[4].body))).toEqual({
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
    const { asked, s } = store("2026-11-09T23:45:00Z");
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply.body).toMatchObject({ success: true, already: true, scheduled_time: "2026-11-09T23:45:00Z" });
    expect(asked).toEqual([{ clientId: "moburst-client", calendarPostKey: request.calendarPostKey, status: "scheduled", at: "2026-11-09T23:45:00Z" }]);
    expect(sent).toHaveLength(0);
  });

  it("makes no post for a profile in no Sprout group", async () => {
    const { sent, fetchImpl } = sprout({ profiles: { body: { data: [{ customer_profile_id: 5719052, network_type: "linkedin_company", groups: [] }] } } });
    const reply = await sendToSprout(request, store().s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 409, body: { code: "profile_not_in_group" } });
    expect(sent.some((x) => x.url.endsWith("/publishing/posts") || x.url.endsWith("/media/"))).toBe(false);
  });

  it("hands Sprout a smaller version of a design over LinkedIn's 5 MB, and refuses one that no version fits", async () => {
    // 3 Nov 2026: every slide of a LinkedIn carousel was a 6 MB PNG and Sprout took none of them.
    const RENDERED = DESIGN_URL.replace("/object/public/", "/render/image/public/") + "?format=origin";
    const sizes = (original: number, rendered: number, narrower: number) => {
      const { sent, fetchImpl: toSprout } = sprout();
      const fetchImpl = (async (url: string, init: RequestInit) => {
        if (init?.method === "HEAD") {
          const bytes = url === DESIGN_URL ? original : url === RENDERED ? rendered : url.includes("width=1080") ? narrower : null;
          return new Response(null, { status: bytes ? 200 : 404, headers: bytes ? { "content-length": String(bytes), "content-type": "image/png" } : {} });
        }
        return toSprout(url, init);
      }) as unknown as typeof fetch;
      return { sent, fetchImpl };
    };
    const fits = sizes(6_000_772, 3_575_179, 2_606_155);
    const reply = await sendToSprout(request, store().s, { fetchImpl: fits.fetchImpl, ...NO_WAIT });
    expect(reply.status).toBe(200);
    expect((fits.sent.find((x) => x.url.endsWith("/media/"))!.body as FormData).get("media_url")).toBe(RENDERED);
    const tooBig = sizes(9_000_000, 7_000_000, 5_100_000);
    const { rows, s } = store();
    const refused = await sendToSprout(request, s, { fetchImpl: tooBig.fetchImpl, ...NO_WAIT });
    expect(refused).toMatchObject({ status: 422, body: { code: "not_publishable", error: "An image is larger than LinkedIn takes through Sprout (5 MB), even made smaller, so nothing was sent." } });
    expect(tooBig.sent).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it("makes no post when Sprout does not take a file", async () => {
    const { sent, fetchImpl } = sprout({ media: { status: 400, body: { error: "Media content is not a known media type" } } });
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 502, body: { code: "media_not_taken" } });
    expect(sent.some((x) => x.url.endsWith("/publishing/posts"))).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("records a post Sprout refused as failed with the reason, and asks once", async () => {
    const { sent, fetchImpl } = sprout({ post: { status: 400, body: { error: "group_id is required" } } });
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 500, body: { code: "post_not_made" } });
    expect(sent.filter((x) => x.url.endsWith("/publishing/posts"))).toHaveLength(1);
    expect(rows).toEqual([expect.objectContaining({ status: "failed", calendar_post_key: request.calendarPostKey, failure_reason: expect.stringContaining("Sprout") })]);
  });

  it("writes the row as asked right before Sprout is asked to make the post", async () => {
    const { fetchImpl, sent } = sprout();
    const { rows, s } = store();
    const seenAtPost: unknown[] = [];
    const wrapped = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/publishing/posts")) seenAtPost.push(...rows.map((r) => r.status));
      return fetchImpl(url, init);
    }) as unknown as typeof fetch;
    await sendToSprout(request, s, { fetchImpl: wrapped, ...NO_WAIT });
    expect(seenAtPost).toEqual(["asked"]);
    expect(rows).toEqual([expect.objectContaining({ status: "scheduled" })]);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("does not make a second draft when the last write failed after the first was made", async () => {
    const first = sprout();
    const { rows, s } = store(null, { settleFails: true });
    const one = await sendToSprout(request, s, { fetchImpl: first.fetchImpl, ...NO_WAIT });
    expect(one.body).toMatchObject({ success: true, recorded: false, sprout_post_id: "4567890" });
    expect(rows).toEqual([expect.objectContaining({ status: "asked" })]);
    const again = sprout();
    const two = await sendToSprout(request, s, { fetchImpl: again.fetchImpl, ...NO_WAIT });
    expect(two).toMatchObject({ status: 409, body: { code: "send_in_progress" } });
    expect(again.sent.some((x) => x.url.endsWith("/publishing/posts"))).toBe(false);
  });

  it("makes one draft for two presses that arrive together", async () => {
    const { sent, fetchImpl } = sprout();
    const { rows, s } = store();
    const [a, b] = await Promise.all([sendToSprout(request, s, { fetchImpl, ...NO_WAIT }), sendToSprout(request, s, { fetchImpl, ...NO_WAIT })]);
    expect(sent.filter((x) => x.url.endsWith("/publishing/posts"))).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(rows.filter((r) => r.status === "scheduled")).toHaveLength(1);
  });

  it("settles the row as unconfirmed when the answer was lost, so a resend without supersede cannot make a second draft", async () => {
    const lost = sprout();
    const losing = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/publishing/posts")) throw new TypeError("connection reset");
      return lost.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl: losing, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 500, body: { code: "post_not_confirmed" } });
    expect(rows).toEqual([expect.objectContaining({ status: "unconfirmed" })]);
    expect(await sendToSprout(request, s, { fetchImpl: lost.fetchImpl, ...NO_WAIT })).toMatchObject({ status: 409 });
  });

  it.each([
    ["a 2xx answer with an empty body", { status: 200, body: null }],
    ["a server error", { status: 500, body: { error: "internal" } }],
    ["a gateway timeout", { status: 504, body: { error: "timeout" } }],
  ])("keeps the post held as unconfirmed when Sprout gives %s, since it may have made the post", async (_name, post) => {
    const { fetchImpl } = sprout({ post });
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 500, body: { code: "post_not_confirmed" } });
    expect(rows).toEqual([expect.objectContaining({ status: "unconfirmed" })]);
    const again = sprout();
    expect(await sendToSprout(request, s, { fetchImpl: again.fetchImpl, ...NO_WAIT })).toMatchObject({ status: 409, body: { code: "send_in_progress" } });
    expect(again.sent.some((x) => x.url.endsWith("/publishing/posts"))).toBe(false);
  });

  it("records a 503 that lasts through the resends as failed, since Sprout documents it as a request it could not process, and the post can be sent again", async () => {
    const { fetchImpl, sent } = sprout({ post: { status: 503, body: { error: "unavailable" } } });
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 500, body: { code: "post_not_made" } });
    expect(sent.filter((x) => x.url.endsWith("/publishing/posts"))).toHaveLength(3);
    expect(rows).toEqual([expect.objectContaining({ status: "failed", failure_reason: expect.stringContaining("503") })]);
    const again = sprout();
    expect(await sendToSprout(request, s, { fetchImpl: again.fetchImpl, ...NO_WAIT })).toMatchObject({ status: 200, body: { success: true } });
  });

  it("records a 2xx answer with no post for the profile as failed, since Sprout made none, and the post can be sent again", async () => {
    const { fetchImpl } = sprout({ post: { status: 200, body: { data: [] } } });
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 500, body: { code: "post_not_made" } });
    expect(rows).toEqual([expect.objectContaining({ status: "failed", failure_reason: expect.stringContaining("no post") })]);
    const again = sprout();
    expect(await sendToSprout(request, s, { fetchImpl: again.fetchImpl, ...NO_WAIT })).toMatchObject({ status: 200, body: { success: true } });
    expect(again.sent.filter((x) => x.url.endsWith("/publishing/posts"))).toHaveLength(1);
  });

  it("keeps the post held as unconfirmed when Sprout's answer has the profile's entry with no post id to read, since that entry says it made the post", async () => {
    const { fetchImpl } = sprout({ post: { status: 200, body: { data: [{ customer_profile_id: "5719052", internal: {} }] } } });
    const { rows, s } = store();
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 500, body: { code: "post_not_confirmed" } });
    expect(rows).toEqual([expect.objectContaining({ status: "unconfirmed" })]);
    const again = sprout();
    expect(await sendToSprout(request, s, { fetchImpl: again.fetchImpl, ...NO_WAIT })).toMatchObject({ status: 409, body: { code: "send_in_progress" } });
    expect(again.sent.some((x) => x.url.endsWith("/publishing/posts"))).toBe(false);
  });

  it("asks Sprout nothing, and drops the row, when it cannot be marked asked", async () => {
    const { sent, fetchImpl } = sprout();
    const { rows, s } = store();
    const failing: SentStore = { ...s, settle: async () => false };
    const reply = await sendToSprout(request, failing, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 502, body: { code: "not_recorded" } });
    expect(sent.some((x) => x.url.endsWith("/publishing/posts"))).toBe(false);
    expect(rows).toEqual([]);
  });

  it("asks Sprout nothing when the row cannot be written first", async () => {
    const { sent, fetchImpl } = sprout();
    const s: SentStore = { alreadySent: async () => null, claim: async () => null, settle: async () => true, drop: async () => {} };
    const reply = await sendToSprout(request, s, { fetchImpl, ...NO_WAIT });
    expect(reply).toMatchObject({ status: 502, body: { code: "not_recorded" } });
    expect(sent.some((x) => x.url.endsWith("/publishing/posts"))).toBe(false);
  });
});

describe("sending a post to Sprout now", () => {
  const now = { ...request, scheduledTime: null, sendNow: true };

  it("sends it for the earliest minute Sprout takes, and records it as sent now", async () => {
    const { sent, fetchImpl } = sprout();
    const { rows, asked, s } = store();
    const reply = await sendToSprout(now, s, { fetchImpl, ...NO_WAIT });
    expect(reply.status).toBe(200);
    expect(JSON.parse(String(sent.at(-1)!.body)).delivery).toEqual({ scheduled_times: ["2026-11-02T14:01:00Z"], type: "SCHEDULED" });
    expect(rows).toEqual([expect.objectContaining({ status: "sent_now", scheduled_time: "2026-11-02T14:01:00Z", sprout_post_id: "4567890" })]);
    expect(reply.body).toMatchObject({ success: true, status: "sent_now", scheduled_time: "2026-11-02T14:01:00Z", draft: true });
    // A second press, or a resend, finds this one.
    // Looked for before the files go to Sprout, and again once the row is written.
    const ask = { clientId: "moburst-client", calendarPostKey: request.calendarPostKey, status: "sent_now", since: "2026-11-02T13:45:00.000Z" };
    expect(asked).toEqual([ask, ask]);
  });

  it("is not held by the one-minute rule, which is for scheduling", async () => {
    const { fetchImpl } = sprout();
    const reply = await sendToSprout({ ...now, scheduledTime: "2026-11-02T13:00:00Z" }, store().s, { fetchImpl, ...NO_WAIT });
    expect(reply.status).toBe(200);
  });

  it("still checks the network's rules", async () => {
    const { sent, fetchImpl } = sprout();
    const reply = await sendToSprout({ ...now, text: "x".repeat(3001), mediaUrls: [] }, store().s, { fetchImpl, ...NO_WAIT });
    expect(reply.status).toBe(422);
    expect(sent).toHaveLength(0);
  });

  it("is not sent twice for the same post", async () => {
    const { sent, fetchImpl } = sprout();
    const reply = await sendToSprout(now, store("2026-11-02T13:58:00Z").s, { fetchImpl, ...NO_WAIT });
    expect(reply.body).toMatchObject({ success: true, already: true, status: "sent_now", scheduled_time: "2026-11-02T13:58:00Z" });
    expect(sent).toHaveLength(0);
  });
});

