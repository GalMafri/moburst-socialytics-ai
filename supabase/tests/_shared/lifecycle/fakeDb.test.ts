// @vitest-environment node
// The lifecycle's stand-in database answers as PostgREST does: a row read is
// a copy a later write never changes, and an or filter is applied, so a
// claim's guard is tested (QA 22 Nov 2026, P38-3).
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../support/lifecycleFakeDb";

describe("fakeDb", () => {
  it("returns a snapshot that a later update does not change", async () => {
    const db = fakeDb({ client_lifecycle_steps: [{ client_id: "c1", step: "design_refs", status: "failed", attempts: 2 }] });
    const { data } = await db.from("client_lifecycle_steps").select("*").eq("client_id", "c1");
    const before = (data as Array<{ status: string }>)[0];
    await db.from("client_lifecycle_steps").update({ status: "running" }).eq("client_id", "c1").eq("step", "design_refs");
    expect(before.status).toBe("failed");
    expect(db.tables.client_lifecycle_steps[0].status).toBe("running");
  });

  it("changing a row read changes nothing stored", async () => {
    const db = fakeDb({ clients: [{ id: "c1", name: "Acme" }] });
    const { data } = await db.from("clients").select("*").eq("id", "c1").maybeSingle();
    (data as { name: string }).name = "Other";
    expect(db.tables.clients[0].name).toBe("Acme");
  });

  it("applies an or filter: a claim is refused while a fresh run holds the step", async () => {
    const stale = "2026-11-20T09:30:00.000Z";
    const db = fakeDb({ client_lifecycle_steps: [
      { client_id: "c1", step: "a", status: "running", attempted_at: "2026-11-20T09:50:00.000Z" },
      { client_id: "c1", step: "b", status: "running", attempted_at: "2026-11-20T09:00:00.000Z" },
      { client_id: "c1", step: "c", status: "failed", attempted_at: "2026-11-20T09:50:00.000Z" },
    ] });
    const claim = async (step: string) => (await db.from("client_lifecycle_steps").update({ status: "running" })
      .eq("client_id", "c1").eq("step", step).or(`status.neq.running,attempted_at.lt."${stale}"`).select("step")).data as unknown[];
    expect(await claim("a")).toHaveLength(0);
    expect(await claim("b")).toHaveLength(1);
    expect(await claim("c")).toHaveLength(1);
  });

  it("reads is.null, in lists and and() groups", async () => {
    const db = fakeDb({ t: [{ id: 1, x: null, s: "queued", c: "2026-01-02" }, { id: 2, x: "2026-01-01", s: "done", c: "2026-01-01" }, { id: 3, x: "2026-03-01", s: "done", c: "2026-01-01" }] });
    const ids = async (expr: string) => ((await db.from("t").select("*").or(expr)).data as Array<{ id: number }>).map((r) => r.id);
    expect(await ids("x.is.null,x.lt.2026-02-01")).toEqual([1, 2]);
    expect(await ids("s.in.(queued,running)")).toEqual([1]);
    expect(await ids("c.gt.2026-01-01,and(c.eq.2026-01-01,id.lt.3)")).toEqual([1, 2]);
  });
});
