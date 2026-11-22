// @vitest-environment node
// P29-02 (QA 22 Nov 2026): the picture service's own 500 (it ran and crashed on this input) is classed as
// "unavailable", so the job waits pass after pass with no try spent and no replacement.
import { expect, it, vi } from "vitest";
import { callPicture, PictureError } from "../../../functions/_shared/picture/client";
import { recordStepError } from "../../../functions/_shared/canva/stepError";
import { jobRow } from "./jobRow";

const crash = () => new Response(JSON.stringify({ ok: false, reason: "TypeError: Cannot read properties of undefined (reading 'width')" }), { status: 500, headers: { "content-type": "application/json" } });

it("a picture-service 500 that repeats on every pass eventually spends the job's tries", async () => {
  const { row, admin, read } = jobRow({ step: "locate", design_request_id: "req-1" });
  const db = { rpc: vi.fn(async () => ({ data: "00000000-0000-4000-8000-000000000001", error: null })) };
  for (let pass = 0; pass < 20; pass++) {
    const fetchImpl = (async () => crash()) as unknown as typeof fetch;
    const e = await callPicture(db, "finish", {} as never, { fetchImpl, baseUrl: "https://pictures.test", sleep: async () => {} }).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(PictureError);
    await recordStepError(admin, read(), e, { maxAttempts: 4, worker: "design-worker" });
  }
  // 20 passes, each one the service's own crash answer, twice: the job should have failed so its option is replaced.
  expect({ status: row.status, attempts: row.attempts }).toMatchObject({ status: "failed" });
});

it("reads the service's own 500 as its answer (spent try), and a 503 or a platform 500 page as a wait", async () => {
  const db = { rpc: vi.fn(async () => ({ data: "00000000-0000-4000-8000-000000000001", error: null })) };
  let calls = 0;
  const once = (r: () => Response) => (async () => { calls += 1; return r(); }) as unknown as typeof fetch;
  const own = await callPicture(db, "finish", {} as never, { fetchImpl: once(crash), baseUrl: "https://pictures.test", sleep: async () => {} }).then(() => null, (x) => x);
  expect(own).toMatchObject({ why: "unusable", status: 500, transient: false });
  // Nothing to retry: the route ran and failed on this input.
  expect(calls).toBe(1);
  const down = () => new Response(JSON.stringify({ ok: false, reason: "Storage is unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  const page = () => new Response("<html>Internal Server Error</html>", { status: 500 });
  for (const r of [down, page]) {
    const e = await callPicture(db, "finish", {} as never, { fetchImpl: once(r), baseUrl: "https://pictures.test", sleep: async () => {} }).then(() => null, (x) => x);
    expect(e).toMatchObject({ transient: true });
  }
});
