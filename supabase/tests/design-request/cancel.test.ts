import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../support/lifecycleFakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";
import { type CancelDeps, cancelRequest } from "../../functions/design-request/cancel";

// Stopping a design being prepared: whoever could start it can stop it.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const NOW = new Date("2026-11-03T12:00:00Z");

function setup(status = "preparing") {
  const db = fakeDb({
    design_requests: [{ id: "req-1", client_id: "c1", status }],
    canva_finish_jobs: [
      { id: "j1", design_request_id: "req-1", status: "running", lease_until: "2026-11-03T12:05:00Z" },
      { id: "j2", design_request_id: "req-1", status: "queued", lease_until: null },
      { id: "j3", design_request_id: "req-1", status: "done", lease_until: null },
      { id: "j4", design_request_id: "req-other", status: "running", lease_until: null },
    ] as Row[],
  });
  const d = { db, requireMember: vi.fn(async () => "person-1"), now: () => NOW } satisfies CancelDeps;
  return { db, d };
}
const states = (db: ReturnType<typeof setup>["db"]) => Object.fromEntries(db.tables.canva_finish_jobs.map((j) => [j.id, j.status]));

describe("cancel", () => {
  it("refuses a signed-in user who is not a member of the request's client, and leaves the jobs running", async () => {
    const { db, d } = setup();
    d.requireMember.mockRejectedValue(new AuthzError(403, "You do not have access to this client."));
    await expect(cancelRequest(d, { request_id: "req-1" })).rejects.toMatchObject({ status: 403 });
    expect(d.requireMember).toHaveBeenCalledWith("c1");
    expect(states(db)).toEqual({ j1: "running", j2: "queued", j3: "done", j4: "running" });
    expect(db.tables.design_requests[0].status).toBe("preparing");
  });

  it("stops the request and its unfinished jobs, and no other request's", async () => {
    const { db, d } = setup();
    const answer = await cancelRequest(d, { request_id: "req-1" });
    expect(answer.body.request).toMatchObject({ id: "req-1", status: "canceled" });
    expect(states(db)).toEqual({ j1: "canceled", j2: "canceled", j3: "done", j4: "running" });
    expect(db.tables.canva_finish_jobs[0].lease_until).toBeNull();
  });

  it("answers the request as it is when it is no longer being prepared, and changes nothing", async () => {
    const { db, d } = setup("ready");
    const answer = await cancelRequest(d, { request_id: "req-1" });
    expect(answer.body.request).toMatchObject({ status: "ready" });
    expect(states(db).j1).toBe("running");
  });

  it("answers 404 for a request that is not there", async () => {
    const { d } = setup();
    expect(await cancelRequest(d, { request_id: "nope" })).toMatchObject({ status: 404 });
  });
});
