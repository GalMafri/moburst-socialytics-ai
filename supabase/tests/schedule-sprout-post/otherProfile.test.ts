// @vitest-environment node
// P61-01: Send to Sprout for a second profile of the same post and minute answers
// "already sent" and makes no draft for that profile (send.ts alreadySent ignores the profile).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendToSprout, type SendRequest } from "../../../supabase/functions/schedule-sprout-post/send";
import { sentStore } from "../../../supabase/functions/schedule-sprout-post/store";
import { fakeDb, type FakeCall } from "../../../supabase/functions/_shared/db.fake";

const g = globalThis as { Deno?: unknown };
const KEY = "post:5f0c2a1e-7d3b-4c8e-9a61-2b4d8e9f0c17";
// The post already went to the client's first LinkedIn page (profile row sp-a) for 23:45.
const table: Record<string, unknown>[] = [
  { id: "row-a", client_id: "c1", calendar_post_key: KEY, status: "scheduled", scheduled_time: "2026-11-09T23:45:00+00:00", profile_id: "sp-a", sprout_post_id: "111" },
];
function answer(call: FakeCall) {
  if (call.table !== "scheduled_posts") return { data: null };
  const isSelect = call.ops.some(([n]) => n === "select") && !call.ops.some(([n]) => ["insert", "update", "delete"].includes(n));
  if (!isSelect) return { data: [{ id: "row-new" }] };
  const eq = call.ops.filter(([n]) => n === "eq").map(([, a]) => a as [string, unknown]);
  const hit = table.filter((r) => eq.every(([c, v]) => c === "scheduled_time" ? Date.parse(String(r[c])) === Date.parse(String(v)) : r[c] === v));
  return { data: hit };
}

const sent: string[] = [];
const fetchImpl = (async (url: string) => {
  sent.push(url);
  const body = url.includes("identity") ? { access_token: "***" }
    : url.endsWith("/metadata/customer") ? { data: [{ customer_profile_id: 222, network_type: "linkedin_company", name: "Second page", groups: [1] }] }
    : { data: [{ customer_profile_id: "222", internal: { publishing: { publishing_post_id: 999, perma_link: null, deliveries: [] } } }] };
  return new Response(JSON.stringify(body), { status: 200 });
}) as unknown as typeof fetch;

beforeEach(() => {
  g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "id", SPROUT_CLIENT_SECRET: "***" } as Record<string, string>)[k] } };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T14:00:00Z"));
});
afterEach(() => { delete g.Deno; vi.useRealTimers(); });

it("sends the post to the second profile instead of answering 'already sent'", async () => {
  const { db } = fakeDb(answer);
  const req: SendRequest = {
    clientId: "c1", reportId: null, calendarPostKey: KEY,
    profile: { rowId: "sp-b", sproutProfileId: 222, networkType: "linkedin_company" },
    platform: "LinkedIn", text: "Three things we changed this quarter.", mediaUrls: [],
    scheduledTime: "2026-11-09T23:45:00.000Z", customerId: "1676448", createdBy: "staff",
  };
  const reply = await sendToSprout(req, sentStore(db, { waits: [] }), { fetchImpl, waits: [0, 0] });
  // The dialog toasts "Sent to Sprout as a draft" on success: true, so success must mean a draft for THIS profile.
  expect(reply.body.already).not.toBe(true);
  expect(sent.some((u) => u.endsWith("/publishing/posts"))).toBe(true);
});
