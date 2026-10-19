import { describe, expect, it } from "vitest";
import { decide, retryAfterMinutes, rowAfter, type StepRow } from "./policy";

const NOW = new Date("2026-10-20T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const row = (patch: Partial<StepRow>): StepRow => ({
  client_id: "c", step: "design_refs", inputs_key: "k1", status: "done", attempts: 0,
  attempted_at: hoursAgo(1), done_at: hoursAgo(1), next_attempt_at: null, result: null, error: null, ...patch,
});
const policy = { refreshDays: 90, recheckDays: 30 };

describe("decide", () => {
  it("waits quietly while the input does not exist", () => {
    expect(decide(null, null, policy, NOW)).toMatchObject({ due: false, why: "no_input" });
  });
  it("runs a new step, and again when its inputs change", () => {
    expect(decide(null, "k1", policy, NOW)).toMatchObject({ due: true, force: false, why: "new" });
    expect(decide(row({}), "k2", policy, NOW)).toMatchObject({ due: true, why: "inputs_changed" });
  });
  it("leaves a current result alone, and refreshes it after its period", () => {
    expect(decide(row({}), "k1", policy, NOW)).toMatchObject({ due: false, why: "current" });
    expect(decide(row({ done_at: hoursAgo(24 * 91) }), "k1", policy, NOW)).toMatchObject({ due: true, force: true, why: "refresh" });
  });
  it("retries a failure when its time comes, never before", () => {
    expect(decide(row({ status: "failed", next_attempt_at: hoursAgo(-1) }), "k1", policy, NOW)).toMatchObject({ due: false, why: "later" });
    expect(decide(row({ status: "failed", next_attempt_at: hoursAgo(0.1) }), "k1", policy, NOW)).toMatchObject({ due: true, force: true, why: "retry" });
  });
  it("rechecks a wait for more data, and leaves a wait for an input to the input", () => {
    expect(decide(row({ status: "waiting", next_attempt_at: hoursAgo(1) }), "k1", policy, NOW)).toMatchObject({ due: true, why: "recheck" });
    expect(decide(row({ status: "waiting", next_attempt_at: null }), "k1", policy, NOW)).toMatchObject({ due: false, why: "later" });
  });
  it("never doubles a live run, and restarts one that died", () => {
    expect(decide(row({ status: "running", attempted_at: hoursAgo(0.1) }), "k1", policy, NOW)).toMatchObject({ due: false, why: "running" });
    expect(decide(row({ status: "running", attempted_at: hoursAgo(1) }), "k1", policy, NOW)).toMatchObject({ due: true, why: "stale_run" });
  });
});

describe("rowAfter", () => {
  const base = { client_id: "c", step: "design_refs", inputs_key: "k1" };
  it("backs off on repeated failures with the same inputs, through the running mark", () => {
    const first = rowAfter(null, base, { status: "failed", error: "down" }, NOW);
    expect(first.attempts).toBe(1);
    expect(Date.parse(first.next_attempt_at!) - NOW.getTime()).toBe(retryAfterMinutes(1) * 60_000);
    const marked = { ...first, status: "running" as const };
    const second = rowAfter(marked, base, { status: "failed", error: "down" }, NOW);
    expect(second.attempts).toBe(2);
    expect(Date.parse(second.next_attempt_at!) - NOW.getTime()).toBe(retryAfterMinutes(2) * 60_000);
  });
  it("keeps retrying weekly, never gives up", () => {
    expect(retryAfterMinutes(9)).toBe(7 * 24 * 60);
  });
  it("starts counting again when the inputs change, and clears on success", () => {
    const failed = rowAfter(null, base, { status: "failed", error: "down" }, NOW);
    expect(rowAfter(failed, { ...base, inputs_key: "k2" }, { status: "failed", error: "down" }, NOW).attempts).toBe(1);
    const ok = rowAfter(failed, base, { status: "done", result: { references: 8 } }, NOW);
    expect(ok).toMatchObject({ status: "done", attempts: 0, error: null, next_attempt_at: null });
  });
  it("keeps the last good result while waiting or failing on the same inputs", () => {
    const ok = rowAfter(null, base, { status: "done", result: { references: 8 } }, NOW);
    expect(rowAfter(ok, base, { status: "waiting", reason: "designed_posts", recheckDays: 30 }, NOW).result).toMatchObject({ references: 8, waiting_for: "designed_posts" });
    expect(rowAfter(ok, base, { status: "failed", error: "down" }, NOW).result).toMatchObject({ references: 8 });
  });
});
