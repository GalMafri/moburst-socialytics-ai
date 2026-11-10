// @vitest-environment node
// The clip step with fake services: the one paid clip is ordered once, its
// order recorded before it is submitted, and no pass runs on past it.
import { describe, it, expect } from "vitest";
import { type ClipDeps, runClip } from "../../../functions/_shared/video/clipStep";
import { ORDER_GRACE_MS, REASONS } from "../../../functions/_shared/video/clip";

const T0 = Date.parse("2026-11-11T10:00:00.000Z");

function job(state: Record<string, unknown> = {}, approved: number | null = 128) {
  return {
    id: "job-1", client_id: "c1", step: "clip", design_request_id: null, option_index: 0,
    state: { frame_path: "c1/frame-1.jpg", ...state },
    input: { kind: "video", approved_credits: approved, video: { prompt: "A shrimp fries in a pan." }, people: "none", scene_words: [] },
  };
}

function fakes(over: Partial<ClipDeps> & { clock?: { t: number }; orderWon?: boolean } = {}) {
  const calls: string[] = [];
  const clock = over.clock ?? { t: T0 };
  let recorded = false;
  const deps: ClipDeps = {
    quote: async () => { calls.push("quote"); return 128; },
    balance: async () => { calls.push("balance"); return 1000; },
    importImages: async (want) => { calls.push(`import:${want.frame ? "frame" : ""}${want.kit ? "+kit" : ""}`); return { frame: want.frame ? "frame-id" : undefined, kit: want.kit ? ["k1", "k2"] : undefined }; },
    submit: async () => { calls.push("submit"); return { job_id: "hf-1", kind: "video" } as never; },
    saveOrder: async () => {
      calls.push("saveOrder");
      if (over.orderWon === false || recorded) return false;
      recorded = true;
      return true;
    },
    saveJob: async () => { calls.push("saveJob"); },
    renewLease: async () => { calls.push("renewLease"); },
    now: () => clock.t,
    pollMs: 30_000,
    ...over,
  };
  return { deps, calls, clock };
}

describe("runClip", () => {
  it("imports, renews its lease and records the order before it submits, then waits for the clip", async () => {
    const { deps, calls } = fakes();
    const j = job();
    expect(await runClip(deps, j)).toBe("wait");
    expect(calls).toEqual(["balance", "quote", "import:frame+kit", "renewLease", "saveOrder", "submit", "saveJob"]);
    expect(j.step).toBe("clip_wait");
    expect(j.state).toMatchObject({ frame_ref_id: "frame-id", kit_ref_ids: ["k1", "k2"], clip_order: { price: 128, job_id: "hf-1" }, clip_job: { job_id: "hf-1" } });
    expect((j.state as any).credits).toEqual([{ what: "footage", job_id: "hf-1", credits: 128, at: (j.state as any).clip_order.at }]);
  });

  it("submits nothing when the order could not be recorded, and leaves the row to the pass that did", async () => {
    const { deps, calls } = fakes({ orderWon: false });
    const j = job();
    expect(await runClip(deps, j)).toBe("held");
    expect(calls).not.toContain("submit");
    expect(calls).not.toContain("saveJob");
    expect((j.state as any).clip_order).toBeUndefined();
    expect(j.step).toBe("clip");
  });

  it("reuses the ids of images already handed over", async () => {
    const { deps, calls } = fakes();
    await runClip(deps, job({ frame_ref_id: "f0", kit_ref_ids: ["k0"] }));
    expect(calls.some((c) => c.startsWith("import"))).toBe(false);
    const half = fakes();
    const j = job({ kit_ref_ids: ["k0"] });
    await runClip(half.deps, j);
    expect(half.calls).toContain("import:frame");
    expect((j.state as any).kit_ref_ids).toEqual(["k0"]);
  });

  it("keeps the imports' ids when the step fails before its order, and orders nothing", async () => {
    const { deps, calls } = fakes({ renewLease: async () => { throw new Error("database down"); } });
    const j = job();
    await expect(runClip(deps, j)).rejects.toThrow("database down");
    expect(calls).not.toContain("saveOrder");
    expect(calls).not.toContain("submit");
    expect(j.state).toMatchObject({ frame_ref_id: "frame-id", kit_ref_ids: ["k1", "k2"] });
    expect((j.state as any).clip_order).toBeUndefined();
    // The next pass (after the price's poll interval) reuses them.
    const next = fakes({ clock: { t: T0 + 30_000 } });
    await runClip(next.deps, j);
    expect(next.calls).toEqual(["balance", "quote", "renewLease", "saveOrder", "submit", "saveJob"]);
  });

  it("never orders again after a submit that failed: it waits out the grace, then ends the video", async () => {
    const clock = { t: T0 };
    const first = fakes({ clock, submit: async () => { throw new Error("Higgsfield timed out"); } });
    const j = job();
    await expect(runClip(first.deps, j)).rejects.toThrow("Higgsfield timed out");
    expect((j.state as any).clip_order).toMatchObject({ price: 128 });
    expect((j.state as any).clip_order.job_id).toBeUndefined();

    clock.t = T0 + ORDER_GRACE_MS - 1_000;
    const inside = fakes({ clock });
    expect(await runClip(inside.deps, j)).toBe("wait");
    expect(inside.calls).toEqual([]);
    expect(j.step).toBe("clip");

    clock.t = T0 + ORDER_GRACE_MS + 1_000;
    const after = fakes({ clock });
    await expect(runClip(after.deps, j)).rejects.toThrow(`FINAL: ${REASONS.lostOrder}`);
    expect(after.calls).toEqual([]);
  });

  it("moves an order with its job id to clip_wait without pricing, importing or submitting", async () => {
    const { deps, calls } = fakes();
    const j = job({ clip_order: { price: 128, at: new Date(T0).toISOString(), job_id: "hf-1" }, clip_job: { job_id: "hf-1" } });
    expect(await runClip(deps, j)).toBe("wait");
    expect(calls).toEqual([]);
    expect(j.step).toBe("clip_wait");
  });

  it("waits for a price it cannot read, then stops; and stops at once above the approved price or with none", async () => {
    const clock = { t: T0 };
    let quotes = 0;
    const unread = fakes({ clock, quote: async () => { quotes++; return null; } });
    const j = job();
    expect(await runClip(unread.deps, j)).toBe("wait");
    clock.t += 10_000;
    expect(await runClip(unread.deps, j)).toBe("wait");
    // Read again only after the poll interval.
    expect(quotes).toBe(1);
    clock.t = T0 + 31 * 60_000;
    await expect(runClip(unread.deps, j)).rejects.toThrow(`FINAL: ${REASONS.quote}`);
    expect(unread.calls).not.toContain("saveOrder");

    const dear = fakes({ quote: async () => 144 });
    await expect(runClip(dear.deps, job())).rejects.toThrow(`FINAL: ${REASONS.price}`);
    const never = fakes();
    await expect(runClip(never.deps, job({}, null))).rejects.toThrow(`FINAL: ${REASONS.unquoted}`);
    for (const f of [dear, never]) expect(f.calls).not.toContain("submit");
  });

  it("never runs on to another step in the same pass", async () => {
    const results: string[] = [];
    for (const state of [{}, { clip_order: { price: 1, at: new Date(T0).toISOString() } }, { clip_order: { price: 1, at: "x", job_id: "j" } }]) {
      results.push(await runClip(fakes().deps, job(state)));
    }
    results.push(await runClip(fakes({ orderWon: false }).deps, job()));
    results.push(await runClip(fakes({ quote: async () => null }).deps, job()));
    expect(results).not.toContain("next");
  });
});
