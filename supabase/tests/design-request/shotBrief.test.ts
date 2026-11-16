import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../functions/_shared/lifecycle/fakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";
import { type ShotBriefDeps, shotBriefFor } from "../../functions/design-request/shotBrief";

// The shot brief for a filmed video post: staff with write access to the
// request's client, checked once.

function setup(requests = [{ id: "req-1", client_id: "c1" }]) {
  const d = {
    db: fakeDb({ design_requests: requests }),
    requireStaff: vi.fn(async () => ({ userId: "staff-1" })),
    write: vi.fn(async () => ({ shots: ["a wide shot of the bench"] })),
  } satisfies ShotBriefDeps;
  return d;
}

describe("shot_brief", () => {
  it("checks write access to the request's client once and writes the brief", async () => {
    const d = setup();
    expect(await shotBriefFor(d, { request_id: "req-1" })).toEqual({ body: { brief: { shots: ["a wide shot of the bench"] } } });
    expect(d.requireStaff).toHaveBeenCalledTimes(1);
    expect(d.requireStaff).toHaveBeenCalledWith("c1");
    expect(d.write).toHaveBeenCalledWith("req-1");
  });

  it("refuses a staff member without write access to that client, and writes nothing", async () => {
    const d = setup();
    d.requireStaff.mockRejectedValue(new AuthzError(403, "You do not have write access to this client."));
    await expect(shotBriefFor(d, { request_id: "req-1" })).rejects.toMatchObject({ status: 403 });
    expect(d.write).not.toHaveBeenCalled();
  });

  it("answers 404 for a request that is not there, but only to staff", async () => {
    const d = setup();
    expect(await shotBriefFor(d, { request_id: "nope" })).toMatchObject({ status: 404 });
    expect(d.requireStaff).toHaveBeenCalledTimes(1);
    expect(d.write).not.toHaveBeenCalled();
    const outsider = setup();
    outsider.requireStaff.mockRejectedValue(new AuthzError(403, "Not allowed."));
    await expect(shotBriefFor(outsider, { request_id: "nope" })).rejects.toMatchObject({ status: 403 });
  });
});
