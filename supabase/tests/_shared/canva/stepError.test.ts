// @vitest-environment node
import { describe, expect, it } from "vitest";
import { recordStepError, waitOver, waitsOut } from "../../../functions/_shared/canva/stepError";
import { ModelBusy } from "../../../functions/_shared/media/modelBusy";
import { PictureError } from "../../../functions/_shared/picture/client";

/** A fake admin client that records each update and the filters it ran under. */
function fakeAdmin() {
  const updates: Array<{ table: string; values: Record<string, unknown>; eq: unknown[]; in: unknown[] }> = [];
  const admin = {
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          const row = { table, values, eq: [] as unknown[], in: [] as unknown[] };
          updates.push(row);
          const chain = {
            eq(...a: unknown[]) { row.eq.push(a); return chain; },
            in(...a: unknown[]) { row.in.push(a); return Promise.resolve({ error: null }); },
          };
          return chain;
        },
      };
    },
  };
  return { admin, updates };
}

const job = (attempts: number) => ({ id: "job-1", step: "finish", attempts, state: { final_path: null, kept: 1 } });
const opts = { maxAttempts: 4, worker: "design-worker" };

describe("waitsOut", () => {
  it("is true for a busy image model and an unavailable picture service", () => {
    expect(waitsOut(new ModelBusy("Image model 429"))).toBe(true);
    expect(waitsOut(new PictureError("The picture service did not answer: 503.", "finish", "unavailable"))).toBe(true);
    expect(waitsOut(new PictureError("The picture service was not called: the database could not open a call.", "finish", "unavailable"))).toBe(true);
  });

  it("is false for a refusal and for any other error", () => {
    expect(waitsOut(new PictureError("The picture service refused the call (400): Bad request.", "finish", "refused"))).toBe(false);
    expect(waitsOut(new PictureError("A picture could not be read from storage.", "finish", "unusable"))).toBe(false);
    expect(waitsOut(new Error("The title's words could not be read."))).toBe(false);
    expect(waitsOut("text")).toBe(false);
  });
});

describe("recordStepError", () => {
  it("keeps the reason and releases the lease without spending a try when the picture service is unavailable", async () => {
    const { admin, updates } = fakeAdmin();
    const outcome = await recordStepError(admin, job(3), new PictureError("The picture service did not answer: timeout.", "finish", "unavailable"), opts);
    expect(outcome).toBe("wait");
    expect(updates).toHaveLength(1);
    const { values } = updates[0];
    expect(values.error).toBe("The picture service did not answer: timeout.");
    expect(values.lease_until).toBeNull();
    expect(values.state).toEqual({ final_path: null, kept: 1 });
    // The step is saved with the state: the job goes on from where it is, not from where the pass found it.
    expect(values.step).toBe("finish");
    expect(values).not.toHaveProperty("attempts");
    expect(values).not.toHaveProperty("status");
    expect(updates[0].table).toBe("canva_finish_jobs");
    expect(updates[0].eq).toEqual([["id", "job-1"]]);
    expect(updates[0].in).toEqual([["status", ["queued", "running"]]]);
  });

  it("waits out a busy image model the same way", async () => {
    const { admin, updates } = fakeAdmin();
    expect(await recordStepError(admin, job(0), new ModelBusy("Image model 503"), opts)).toBe("wait");
    expect(updates[0].values).not.toHaveProperty("attempts");
  });

  it("waits on the job's last try too, so an outage never fails a job", async () => {
    const { admin, updates } = fakeAdmin();
    expect(await recordStepError(admin, job(3), new PictureError("The picture service was not called: the database could not open a call.", "read", "unavailable"), opts)).toBe("wait");
    expect(updates[0].values).not.toHaveProperty("status");
  });

  it("ends a job that has no request once it still waits after the request limit, with the reason and no try spent", async () => {
    const made = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const down = () => new PictureError("The picture service was not called: the database could not open a call.", "transcode", "unavailable");
    // The style job has no request for the 90-minute limit to end, so its own age is its limit.
    const young = fakeAdmin();
    expect(await recordStepError(young.admin, { ...job(1), design_request_id: null, created_at: made(89) }, down(), opts)).toBe("wait");
    expect(young.updates[0].values).not.toHaveProperty("status");

    const old = fakeAdmin();
    expect(await recordStepError(old.admin, { ...job(1), design_request_id: null, created_at: made(91) }, down(), opts)).toBe("failed");
    expect(old.updates[0].values).toMatchObject({
      status: "failed", attempts: 1, step: "finish", lease_until: null,
      error: "Still waiting after 90 minutes: The picture service was not called: the database could not open a call.",
    });

    // A job of a request waits on: its request's limit ends it (endOverdueRequests).
    const requested = fakeAdmin();
    expect(await recordStepError(requested.admin, { ...job(1), design_request_id: "req-1", created_at: made(600) }, down(), opts)).toBe("wait");
    expect(waitOver({ design_request_id: null, created_at: made(91) }, Date.now())).toBe(true);
    expect(waitOver({ design_request_id: null, created_at: made(89) }, Date.now())).toBe(false);
    expect(waitOver({ design_request_id: "req-1", created_at: made(91) }, Date.now())).toBe(false);
  });

  it("spends a try on a refusal and keeps the job running", async () => {
    const { admin, updates } = fakeAdmin();
    const outcome = await recordStepError(admin, job(1), new PictureError("The picture service refused the call (400).", "finish", "refused"), opts);
    expect(outcome).toBe("retry");
    expect(updates[0].values).toMatchObject({ attempts: 2, status: "running", step: "finish", state: { final_path: null, kept: 1 }, error: "The picture service refused the call (400)." });
    // It rests before its next try (QA 22 Nov 2026): two minutes after its second.
    expect(Date.parse(updates[0].values.lease_until as string) - Date.now()).toBeGreaterThan(110_000);
  });

  it("fails the job on its last try or a FINAL reason, without the FINAL mark in the reason", async () => {
    const last = fakeAdmin();
    expect(await recordStepError(last.admin, job(3), new Error("The title's words could not be read."), opts)).toBe("failed");
    expect(last.updates[0].values).toMatchObject({ attempts: 4, status: "failed" });
    const final = fakeAdmin();
    expect(await recordStepError(final.admin, job(0), new Error("FINAL: The logo could not be taken out of the design."), opts)).toBe("failed");
    expect(final.updates[0].values).toMatchObject({ attempts: 1, status: "failed", error: "The logo could not be taken out of the design." });
  });

  it("counts a job without attempts as on its first try", async () => {
    const { admin, updates } = fakeAdmin();
    await recordStepError(admin, { id: "job-1", step: "frame", state: {} }, new Error("Could not store the opening frame."), opts);
    expect(updates[0].values).toMatchObject({ attempts: 1, status: "running" });
  });
});
