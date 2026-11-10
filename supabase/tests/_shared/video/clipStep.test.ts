// @vitest-environment node
// The clip step with fake services over one fake job row: the one paid clip
// is ordered once, its order placed (in its own column) before it is
// submitted, no pass runs on past it, and a second pass on the same job can
// neither order again, nor fail it, nor erase its order.
import { describe, it, expect } from "vitest";
import { type ClipDeps, runClip } from "../../../functions/_shared/video/clipStep";
import { type ClipOrder, ORDER_GRACE_MS, REASONS } from "../../../functions/_shared/video/clip";

const T0 = Date.parse("2026-11-11T10:00:00.000Z");

/** The job's row as the fenced statements and the worker's saves see it. */
type Row = { status: string; error: string | null; state: any; step: string; clip_order: ClipOrder | null };
function row(): Row {
  return { status: "running", error: null, state: { frame_path: "c1/frame-1.jpg" }, step: "clip", clip_order: null };
}

function job(r: Row, approved: number | null = 128) {
  return {
    id: "job-1", client_id: "c1", step: r.step, design_request_id: null, option_index: 0,
    // Each pass reads its own copy, as the worker does.
    state: structuredClone(r.state), clip_order: r.clip_order ? { ...r.clip_order } : null,
    input: { kind: "video", approved_credits: approved, video: { prompt: "A shrimp fries in a pan." }, people: "none", scene_words: [] },
  };
}

/** The worker's save after a pass: step and state, whole (never the order column). */
function workerSave(r: Row, j: ReturnType<typeof job>, result: string) {
  if (result === "held") return;
  r.state = structuredClone(j.state);
  r.step = j.step;
}

function fakes(r: Row, over: Partial<ClipDeps> & { clock?: { t: number } } = {}) {
  const calls: string[] = [];
  const clock = over.clock ?? { t: T0 };
  const active = () => r.status === "queued" || r.status === "running";
  const deps: ClipDeps = {
    readOrder: async () => { calls.push("readOrder"); return r.clip_order ? { ...r.clip_order } : null; },
    quote: async () => { calls.push("quote"); return 128; },
    balance: async () => { calls.push("balance"); return 1000; },
    importImages: async (want) => { calls.push(`import:${want.frame ? "frame" : ""}${want.kit ? "+kit" : ""}`); return { frame: want.frame ? "frame-id" : undefined, kit: want.kit ? ["k1", "k2"] : undefined }; },
    submit: async () => { calls.push("submit"); return { index: 0, job_id: "hf-1" }; },
    saveOrder: async (o) => {
      calls.push("saveOrder");
      if (!active() || r.clip_order) return false;
      r.clip_order = { ...o };
      return true;
    },
    saveOrdered: async (id, credits) => {
      calls.push("saveOrdered");
      if (!r.clip_order || r.clip_order.job_id) return false;
      r.clip_order = { ...r.clip_order, job_id: id, credits };
      return true;
    },
    stopJob: async (reason) => {
      calls.push("stopJob");
      const o = r.clip_order;
      const lost = o && !o.job_id && clock.t - Date.parse(o.at) > ORDER_GRACE_MS;
      if (!active() || (o && !lost)) return false;
      r.status = "failed"; r.error = reason;
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
  it("renews its lease, imports and places the order before it submits, then waits for the clip", async () => {
    const r = row();
    const { deps, calls } = fakes(r);
    const j = job(r);
    expect(await runClip(deps, j)).toBe("wait");
    expect(calls).toEqual(["readOrder", "balance", "quote", "renewLease", "import:frame+kit", "saveOrder", "submit", "saveOrdered", "saveJob"]);
    expect(j.step).toBe("clip_wait");
    expect(r.clip_order).toEqual({ price: 128, at: new Date(T0).toISOString(), job_id: "hf-1", credits: 128 });
    expect(j.clip_order).toEqual(r.clip_order);
    // The state holds the images' ids and times, never the order.
    expect(j.state).toMatchObject({ frame_ref_id: "frame-id", kit_ref_ids: ["k1", "k2"], clip_started_at: T0 });
    for (const k of ["clip_order", "clip_job", "credits"]) expect(j.state).not.toHaveProperty(k);
  });

  it("submits nothing when the order could not be placed, and leaves the row to the pass that did", async () => {
    const r = row();
    r.status = "canceled";
    const { deps, calls } = fakes(r);
    const j = job(r);
    expect(await runClip(deps, j)).toBe("held");
    expect(calls).not.toContain("submit");
    expect(calls).not.toContain("saveJob");
  });

  it("reuses the ids of images already handed over", async () => {
    const r = row();
    r.state = { ...r.state, frame_ref_id: "f0", kit_ref_ids: ["k0"] };
    const { deps, calls } = fakes(r);
    await runClip(deps, job(r));
    expect(calls.some((c) => c.startsWith("import"))).toBe(false);
    const r2 = row();
    r2.state = { ...r2.state, kit_ref_ids: ["k0"] };
    const half = fakes(r2);
    const j = job(r2);
    await runClip(half.deps, j);
    expect(half.calls).toContain("import:frame");
    expect(j.state.kit_ref_ids).toEqual(["k0"]);
  });

  it("keeps the imports' ids when the step fails before its order, and orders nothing", async () => {
    const r = row();
    const { deps, calls } = fakes(r, { importImages: async () => ({ frame: null, kit: ["k1"] }) });
    const j = job(r);
    await expect(runClip(deps, j)).rejects.toThrow("Could not hand the opening frame");
    expect(calls).not.toContain("saveOrder");
    expect(j.state.kit_ref_ids).toEqual(["k1"]);
    expect(r.clip_order).toBeNull();
    // The worker keeps the state with the error; the next pass imports only the frame.
    r.state = structuredClone(j.state);
    const next = fakes(r, { clock: { t: T0 + 30_000 } });
    await runClip(next.deps, job(r));
    expect(next.calls).toEqual(["readOrder", "balance", "quote", "renewLease", "import:frame", "saveOrder", "submit", "saveOrdered", "saveJob"]);
  });

  it("never orders again after a submit that failed: it waits out the grace, then ends the video", async () => {
    const r = row();
    const clock = { t: T0 };
    const first = fakes(r, { clock, submit: async () => { throw new Error("Higgsfield timed out"); } });
    const j = job(r);
    await expect(runClip(first.deps, j)).rejects.toThrow("Higgsfield timed out");
    expect(r.clip_order).toEqual({ price: 128, at: new Date(T0).toISOString() });
    // The worker saves the state with the error: the order column stays as it is.
    workerSave(r, j, "wait");
    expect(r.clip_order).not.toBeNull();

    clock.t = T0 + ORDER_GRACE_MS - 1_000;
    const inside = fakes(r, { clock });
    expect(await runClip(inside.deps, job(r))).toBe("wait");
    expect(inside.calls).toEqual(["readOrder"]);

    clock.t = T0 + ORDER_GRACE_MS + 1_000;
    const after = fakes(r, { clock });
    await expect(runClip(after.deps, job(r))).rejects.toThrow(`FINAL: ${REASONS.lostOrder}`);
    expect(after.calls).toEqual(["readOrder", "stopJob"]);
    expect(r).toMatchObject({ status: "failed", error: REASONS.lostOrder });
  });

  it("moves an order with its job id to clip_wait without pricing, importing or submitting", async () => {
    const r = row();
    r.clip_order = { price: 128, at: new Date(T0).toISOString(), job_id: "hf-1", credits: 128 };
    const { deps, calls } = fakes(r);
    const j = job(r);
    expect(await runClip(deps, j)).toBe("wait");
    expect(calls).toEqual(["readOrder"]);
    expect(j.step).toBe("clip_wait");
    expect(j.clip_order).toEqual(r.clip_order);
  });

  it("waits for a price it cannot read, then stops; and stops at once above the approved price or with none", async () => {
    const clock = { t: T0 };
    let quotes = 0;
    const r = row();
    const unread = fakes(r, { clock, quote: async () => { quotes++; return null; } });
    const j = job(r);
    expect(await runClip(unread.deps, j)).toBe("wait");
    clock.t += 10_000;
    expect(await runClip(unread.deps, j)).toBe("wait");
    // Read again only after the poll interval.
    expect(quotes).toBe(1);
    clock.t = T0 + 31 * 60_000;
    await expect(runClip(unread.deps, j)).rejects.toThrow(`FINAL: ${REASONS.quote}`);
    expect(unread.calls).not.toContain("saveOrder");

    const dearRow = row();
    const dear = fakes(dearRow, { quote: async () => 144 });
    await expect(runClip(dear.deps, job(dearRow))).rejects.toThrow(`FINAL: ${REASONS.price}`);
    expect(dearRow).toMatchObject({ status: "failed", error: REASONS.price });
    const neverRow = row();
    const never = fakes(neverRow);
    await expect(runClip(never.deps, job(neverRow, null))).rejects.toThrow(`FINAL: ${REASONS.unquoted}`);
    for (const f of [dear, never]) expect(f.calls).not.toContain("submit");
  });

  it("never runs on to another step in the same pass", async () => {
    const results: string[] = [];
    const orders: Array<ClipOrder | null> = [null, { price: 1, at: new Date(T0).toISOString() }, { price: 1, at: "x", job_id: "j" }];
    for (const o of orders) {
      const r = row();
      r.clip_order = o;
      results.push(await runClip(fakes(r).deps, job(r)));
    }
    const canceled = row();
    canceled.status = "canceled";
    results.push(await runClip(fakes(canceled).deps, job(canceled)));
    const unread = row();
    results.push(await runClip(fakes(unread, { quote: async () => null }).deps, job(unread)));
    expect(results).not.toContain("next");
  });
});

describe("two passes on one job", () => {
  it("B's price stop is refused once A has ordered, and B leaves the row alone", async () => {
    const r = row();
    // A and B both read the job with no order.
    const a = job(r);
    const b = job(r);
    // B prices first and finds the price gone up, but A orders before B's stop lands.
    const bDeps = fakes(r, {
      quote: async () => {
        expect(await runClip(fakes(r).deps, a)).toBe("wait");
        return 144;
      },
    });
    expect(await runClip(bDeps.deps, b)).toBe("held");
    expect(bDeps.calls).toContain("stopJob");
    workerSave(r, b, "held");
    expect(r.status).toBe("running");
    expect(r.clip_order).toMatchObject({ job_id: "hf-1", credits: 128 });
  });

  it("B's whole-state save after its wait cannot touch A's order", async () => {
    const r = row();
    const b = job(r);
    // A orders while B waits on an unreadable price.
    const bDeps = fakes(r, {
      quote: async () => {
        const a = job(r);
        expect(await runClip(fakes(r).deps, a)).toBe("wait");
        workerSave(r, a, "wait");
        return null;
      },
    });
    const result = await runClip(bDeps.deps, b);
    expect(result).toBe("wait");
    // B's state has no order in it: saved whole, it leaves the column as A placed it.
    workerSave(r, b, result);
    expect(r.clip_order).toMatchObject({ job_id: "hf-1" });
    // B's next pass finds A's order and only waits for the clip.
    const next = fakes(r, { clock: { t: T0 + 60_000 } });
    const b2 = job(r);
    expect(await runClip(next.deps, b2)).toBe("wait");
    expect(next.calls).toEqual(["readOrder"]);
    expect(b2.step).toBe("clip_wait");
  });

  it("only one of two passes that both price the clip places the order and submits", async () => {
    const r = row();
    let submits = 0;
    const a = job(r);
    const b = job(r);
    const aDeps = fakes(r, { submit: async () => { submits++; return { index: 0, job_id: "hf-a" }; } });
    const bDeps = fakes(r, {
      submit: async () => { submits++; return { index: 0, job_id: "hf-b" }; },
      // A places its order while B hands over its images.
      importImages: async () => {
        expect(await runClip(aDeps.deps, a)).toBe("wait");
        return { frame: "f", kit: [] };
      },
    });
    expect(await runClip(bDeps.deps, b)).toBe("held");
    expect(submits).toBe(1);
    expect(r.clip_order).toMatchObject({ job_id: "hf-a" });
  });
});
