import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../functions/_shared/lifecycle/fakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";
import { type FeedbackDeps, designFeedback } from "../../functions/design-request/feedback";

// Turning a design down, or deleting it: the design memory learns, and a new
// design starts for a rejection.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const design = (over: Row = {}): Row => ({ id: "it-1", client_id: "c1", calendar_post_key: "post:1", report_id: null, platform: "Instagram", format: "Single image", post_copy: "Old copy", visual_direction: null, variant_angle: "Design option 1", concept: null, is_selected: true, variant_group_id: "req-0", ...over });

function setup(over: { rows?: Row[]; settings?: Row | null } = {}) {
  const db: FakeDb = fakeDb({
    post_iterations: over.rows ?? [design()],
    design_brand_settings: over.settings === null ? [] : [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z" }],
    design_requests: [{ id: "req-0", video_route: null }],
  });
  const d = {
    db,
    requireMember: vi.fn(async () => "person-1"),
    record: vi.fn(async () => [{ id: "dl-1", pattern_type: "avoid", pattern_description: "Avoid crowded scenes." }]),
    start: vi.fn(async (_s: Row, p: Row) => ({ id: "req-new", ...p })),
  } satisfies FeedbackDeps;
  return { db, d };
}

describe("feedback", () => {
  it("records the reason and starts a new design with the post's current copy", async () => {
    const { db, d } = setup();
    db.tables.post_iterations.push({ id: "edit-1", client_id: "c1", calendar_post_key: "post:1", post_copy: "Edited copy", media_urls: [], created_at: "2026-11-02T10:00:00Z", variant_angle: null });
    const answer = await designFeedback(d, { iteration_id: "it-1", verdict: "rejected", reason: "wrong_style", note: "Too busy" });
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ id: "it-1" }), "rejected", "wrong_style", "Too busy", "person-1");
    expect(d.start.mock.calls[0][1]).toMatchObject({ postKey: "post:1", copy: "Edited copy", requestedBy: "person-1", note: "Too busy", noteLearned: { rules: [{ id: "dl-1", type: "avoid", text: "Avoid crowded scenes." }] } });
    expect(answer.body).toMatchObject({ ok: true, learnings: 1, request: { id: "req-new" } });
  });

  it("deletes without starting anything or teaching anything", async () => {
    const { d } = setup();
    d.record.mockResolvedValue([]);
    const answer = await designFeedback(d, { iteration_id: "it-1", verdict: "deleted" });
    expect(d.record).toHaveBeenCalledWith(expect.anything(), "archived", undefined, undefined, "person-1");
    expect(d.start).not.toHaveBeenCalled();
    expect(answer.body).toMatchObject({ ok: true, learnings: 0, request: null });
  });

  it("starts no new design when asked not to, or when the client's designs are not confirmed", async () => {
    const { d } = setup();
    await designFeedback(d, { iteration_id: "it-1", verdict: "rejected", make_new: false });
    const { d: unset } = setup({ settings: null });
    await designFeedback(unset, { iteration_id: "it-1", verdict: "rejected" });
    expect(d.start).not.toHaveBeenCalled();
    expect(unset.start).not.toHaveBeenCalled();
  });

  it("refuses a caller without access before anything is recorded", async () => {
    const { d } = setup();
    d.requireMember.mockRejectedValue(new AuthzError(403, "You do not have access to this client."));
    await expect(designFeedback(d, { iteration_id: "it-1", verdict: "rejected" })).rejects.toMatchObject({ status: 403 });
    expect(d.record).not.toHaveBeenCalled();
  });

  it("answers 404 for a row that is not a design option, and 400 for another verdict", async () => {
    const { d } = setup({ rows: [design({ variant_angle: "Reference creative 1" })] });
    expect(await designFeedback(d, { iteration_id: "it-1", verdict: "rejected" })).toMatchObject({ status: 404 });
    expect(await designFeedback(d, { iteration_id: "it-1", verdict: "maybe" })).toMatchObject({ status: 400 });
    expect(d.record).not.toHaveBeenCalled();
  });

  // QA 22 Nov 2026 (P56-03): the quiet resend of a rejection whose reply was lost.
  it("a resent rejection of the same design records its rules once", async () => {
    const { db, d } = setup();
    // As recordFeedback does: the design is marked rejected, and its rules are stored.
    d.record.mockImplementation(async (it: Row) => {
      const row = db.tables.post_iterations.find((r) => r.id === it.id)!;
      row.rejected_at = "2026-11-20T10:00:00Z";
      row.is_selected = false;
      return [{ id: `dl-${d.record.mock.calls.length}`, pattern_type: "avoid", pattern_description: "Avoid crowded scenes." }];
    });
    const body = { iteration_id: "it-1", verdict: "rejected", reason: "wrong_style", note: "Too busy" };
    await designFeedback(d, body);
    const again = await designFeedback(d, body);
    expect(d.record).toHaveBeenCalledTimes(1);
    expect(again.body).toMatchObject({ ok: true, learnings: 0 });
  });

  it("deletes a design that was turned down before", async () => {
    const { d } = setup({ rows: [design({ rejected_at: "2026-11-20T10:00:00Z", is_selected: false })] });
    await designFeedback(d, { iteration_id: "it-1", verdict: "deleted" });
    expect(d.record).toHaveBeenCalledWith(expect.anything(), "archived", undefined, undefined, "person-1");
  });
});
