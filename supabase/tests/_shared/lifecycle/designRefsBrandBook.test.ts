// Social AI sync, 18 Nov 2026 (Sinéad): a new client, or one that rebranded,
// has its brand book before it has posts, and onboarding learned its look only
// from posts. EPIC Studios and Parure (no social accounts) never had a look
// learned. The design_refs step now learns it from the brand book when there
// are no posts to learn from, once per book, and never replaces a look the
// posts gave.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const learned = vi.hoisted(() => ({ calls: 0, fail: null as Error | null }));
vi.mock("../../../functions/_shared/brand-references/learnStyle.ts", async (original) => ({
  ...(await original<object>()),
  learnBrandStyle: async () => {
    learned.calls++;
    if (learned.fail) throw learned.fail;
    return { synthesis: { synthesized_at: "2026-11-26T10:00:00.000Z", source_count: 1, learned_from: "brand_book" }, refs: null, cached: false };
  },
}));

import { deps, STEPS } from "../../../functions/_shared/lifecycle/steps";
import { fakeDb, writeClientRpc } from "../../support/lifecycleFakeDb";
import { StyleError } from "../../../functions/_shared/brand-references/errors";
import type { StepRow } from "../../../functions/_shared/lifecycle/policy";

const original = { ...deps };
beforeEach(() => {
  learned.calls = 0;
  learned.fail = null;
  deps.refsIO = (() => ({ now: () => new Date("2026-11-26T10:00:00.000Z"), aiReady: async () => {} })) as never;
});
afterEach(() => { Object.assign(deps, original); });

// deno-lint-ignore no-explicit-any
const epic = (over: Record<string, any> = {}) => ({
  id: "c1", name: "EPIC Studios", sprout_customer_id: null, design_references: null, harvested_design_references: [], design_style_synthesis: null,
  brand_book_file_path: "c1/epic-brand-book.pdf", look_at: null, look_version: null, look_from: null, field_sources: {}, ...over,
});
const dbFor = (c: Record<string, unknown>, profiles: Record<string, unknown>[] = []) =>
  fakeDb({ clients: [c], sprout_profiles: profiles, design_reference_reviews: [], design_reference_choices: [] }, { lifecycle_write_client: writeClientRpc });
const ctx = (previous: StepRow | null = null) => ({ force: false, previous, rows: new Map<string, StepRow>() });
const doneRow = (result: Record<string, unknown>): StepRow => ({
  client_id: "c1", step: "design_refs", inputs_key: "k", status: "done", attempts: 0, attempted_at: null, done_at: "2026-11-20T10:00:00.000Z", next_attempt_at: null, result, error: null,
});

describe("design_refs for a client with no posts and a brand book", () => {
  it("is due once the brand book is there, even with no social accounts", async () => {
    const c = epic();
    expect(await STEPS.design_refs.inputs(dbFor(c), c, new Map())).toBe("book:c1/epic-brand-book.pdf|");
    const none = epic({ brand_book_file_path: null });
    expect(await STEPS.design_refs.inputs(dbFor(none), none, new Map())).toBeNull();
  });

  it("learns the look from the brand book", async () => {
    const c = epic();
    const out = await STEPS.design_refs.run(dbFor(c), c, ctx());
    expect(learned.calls).toBe(1);
    expect(out).toEqual({ status: "done", result: { learned_from: "brand_book", from: "c1/epic-brand-book.pdf|", synthesized_at: "2026-11-26T10:00:00.000Z", sources: 1 } });
  });

  it("does not pay again for the same book on its weekly check", async () => {
    const c = epic({ look_from: "brand_book", look_at: "2026-11-20T10:00:00.000Z" });
    const before = doneRow({ learned_from: "brand_book", from: "c1/epic-brand-book.pdf|", synthesized_at: "2026-11-20T10:00:00.000Z", sources: 1 });
    const out = await STEPS.design_refs.run(dbFor(c), c, ctx(before));
    expect(learned.calls).toBe(0);
    expect(out).toEqual({ status: "done", result: before.result });
  });

  it("learns again when a new brand book is uploaded", async () => {
    const c = epic({ look_from: "brand_book", look_at: "2026-11-20T10:00:00.000Z", brand_book_file_path: "c1/epic-brand-book-2027.pdf" });
    const before = doneRow({ learned_from: "brand_book", from: "c1/epic-brand-book.pdf|", synthesized_at: "2026-11-20T10:00:00.000Z", sources: 1 });
    await STEPS.design_refs.run(dbFor(c), c, ctx(before));
    expect(learned.calls).toBe(1);
  });

  it("never replaces a look learned from the posts", async () => {
    const c = epic({ look_version: "3" });
    const out = await STEPS.design_refs.run(dbFor(c), c, ctx());
    expect(learned.calls).toBe(0);
    expect(out).toEqual({ status: "waiting", reason: "social_accounts" });
  });

  it("never replaces an older look learned from the posts that carries no version", async () => {
    const c = epic({ look_at: "2026-09-01T10:00:00.000Z", look_version: null, look_from: null });
    const out = await STEPS.design_refs.run(dbFor(c), c, ctx());
    expect(learned.calls).toBe(0);
    expect(out).toEqual({ status: "waiting", reason: "social_accounts" });
  });

  it("waits as before when there is no brand book", async () => {
    const c = epic({ brand_book_file_path: null });
    const out = await STEPS.design_refs.run(dbFor(c), c, ctx());
    expect(learned.calls).toBe(0);
    expect(out).toEqual({ status: "waiting", reason: "social_accounts" });
  });

  it("fails, to be tried again, when the book could not be read", async () => {
    learned.fail = new StyleError("provider", "The style analysis did not finish. It will be tried again.");
    const c = epic();
    expect(await STEPS.design_refs.run(dbFor(c), c, ctx())).toEqual({ status: "failed", error: "The style analysis did not finish. It will be tried again." });
  });
});
