// A rewrite the model did not finish (cut off at its limit, or declined) is a
// try that came back unusable: the second try asks again, and after that the
// person reads what the screen always said for a rewrite it cannot use. What
// an edit teaches is nothing when its reply did not finish. Both calls leave
// the model room to think before it answers (18 Nov 2026).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSON_WAIT_MS, roomFor } from "../../functions/_shared/anthropicReply";

const db = vi.hoisted(() => ({ inserts: [] as unknown[] }));
vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        insert: async (row: unknown) => { db.inserts.push(row); return { error: null }; },
        maybeSingle: async () => ({ data: table === "competitive_reports" ? { id: "r1", client_id: "c1", status: "complete", report_data: {} } : null, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("../../functions/_shared/auth/requireStaff.ts", () => ({
  AuthzError: class AuthzError extends Error { status = 403; },
  requireStaff: async () => ({ userId: "u1" }),
}));

const model = vi.hoisted(() => vi.fn());
vi.mock("../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: model }));

let handler: (req: Request) => Promise<Response>;
let replies: Array<{ text: string; stop: string }>;
const sent = () => model.mock.calls.map((c) => ({ model: c[0].body.model as string, max_tokens: c[0].body.max_tokens as number, waitMs: c[0].waitMs as number }));

beforeEach(async () => {
  db.inserts = []; replies = [];
  model.mockReset();
  model.mockImplementation(async () => { const r = replies.shift() ?? { text: "", stop: "max_tokens" }; return { text: r.text, stopReason: r.stop, raw: {} }; });
  vi.stubGlobal("Deno", { env: { get: () => "k" }, serve: (h: typeof handler) => { handler = h; } });
  vi.resetModules();
  await import("../../functions/revise-suggestion/index.ts");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const post = (body: Record<string, unknown>) => handler(new Request("https://f/revise-suggestion", { method: "POST", body: JSON.stringify({ report_id: "r1", ...body }) }));
const CURRENT = { gap: "Post more short video.", why_it_matters: "Competitors do.", suggested_play: "Three Reels a week." };
const GOOD = JSON.stringify({ gap: "Post two Reels a week.", why_it_matters: "Reels reach further.", suggested_play: "Two Reels a week for a month; watch reach." });

describe("revise-suggestion and a reply that did not finish", () => {
  it("asks once more after a rewrite that was cut off, and returns the whole one", async () => {
    replies = [{ text: '{"gap":"Post two Reels a week.","why_it', stop: "max_tokens" }, { text: GOOD, stop: "end_turn" }];
    const res = await post({ feedback: "Shorter.", current: CURRENT });
    expect(res.status).toBe(200);
    expect((await res.json()).revision.gap).toBe("Post two Reels a week.");
    expect(sent().map((b) => [b.model, b.max_tokens])).toEqual([["claude-opus-5-5", roomFor(1500)], ["claude-opus-5-5", roomFor(1500)]]);
    // The two tries share what a person can wait: the first has half of it, the second what is left of the whole.
    const [first, second] = sent().map((b) => b.waitMs);
    expect(first).toBe(PERSON_WAIT_MS / 2);
    expect(second).toBeGreaterThan(PERSON_WAIT_MS - 5_000);
    expect(second).toBeLessThanOrEqual(PERSON_WAIT_MS);
  });

  it("gives the second try only what the first left, so the two never outlast the request", async () => {
    // The first try uses its whole half and comes back with nothing.
    const start = Date.now();
    const clock = vi.spyOn(Date, "now");
    model.mockImplementationOnce(async (a: { waitMs: number }) => { clock.mockReturnValue(start + a.waitMs); return { text: "", stopReason: "timed_out", raw: null }; });
    replies = [{ text: "", stop: "timed_out" }];
    const res = await post({ feedback: "Shorter.", current: CURRENT });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The rewrite did not come back usable. Try again, or edit it by hand." });
    const waits = sent().map((b) => b.waitMs);
    expect(waits[0]).toBe(PERSON_WAIT_MS / 2);
    // The second has the other half (within the test's own milliseconds), never the whole wait over again.
    expect(waits[1]).toBeGreaterThan(0);
    expect(waits[1]).toBeLessThanOrEqual(PERSON_WAIT_MS / 2 + 100);
  });

  it("never returns half a rewrite that happens to parse, and says what the screen always said after two unusable tries", async () => {
    // Whole JSON, and still cut off: it is not an answer.
    replies = [{ text: GOOD, stop: "max_tokens" }, { text: "", stop: "refusal" }];
    const res = await post({ feedback: "Shorter.", current: CURRENT });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The rewrite did not come back usable. Try again, or edit it by hand." });
    // Two tries, never a third.
    expect(sent()).toHaveLength(2);
  });

  it("learns nothing from an edit whose reply was cut off, and saves nothing", async () => {
    replies = [{ text: '{"rules":[{"kind":"prefer","text":"Name the format in every test."}]}', stop: "max_tokens" }];
    const res = await post({ action: "learn", original: CURRENT, edited: { ...CURRENT, gap: "Post two Reels a week." } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ learned: [] });
    expect(db.inserts).toEqual([]);
    expect(sent()).toEqual([{ model: "claude-opus-5-5", max_tokens: roomFor(600), waitMs: PERSON_WAIT_MS }]);
  });
});
