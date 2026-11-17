// @vitest-environment node
// A design job's two searches (the slot on its design, the look for the
// drawing on its cleaned picture) against a picture service that works to a
// time budget (17 Nov 2026). The job's step is run the way the design worker
// runs it (advanceDesignJob over a job row), with the worker's own call
// (logoChoice.ts, slotSearch) and the real client under it; only the service
// is a fake that answers what a real one answers. What holds: an answer
// that is not finished spends no try and loses nothing, the step asks again
// from the point it was given, and it cannot ask without end.
import { describe, expect, it } from "vitest";
import { MAX_DESIGN_ATTEMPTS, type StepResult, advanceDesignJob } from "../../../functions/_shared/design/advance";
import { askCleanedSlot, basePicture } from "../../../functions/_shared/design/firstPictureJob";
import { SEARCH_KEPT, searchKept, searchWorked, slotSearch } from "../../../functions/_shared/design/logoChoice";
import { OF_THE_DESIGN } from "../../../functions/_shared/design/modelSteps";
import { PICTURE_MAX_ASKS, PICTURE_WORK_BUDGET_MS, type SearchSoFar, type SlotFileRequest, type SlotFileResult, type SlotRequest, type SlotResult } from "../../../functions/_shared/picture/contract";
import { jobRow } from "../canva/jobRow";

const DESIGN = "c1/canva-finish/job-1/design-1.png";
const CLEANED = "c1/canva-finish/job-1/nologo-1-1.png";
const slotBody: SlotRequest = { job: "job-1", step: "locate", design: "https://storage.test/read/design.png?token=d", placement: { anchor: "center", width: 0.2, top: 0.04 }, scales: [0.45, 1.35], templates: [{ file: "stored", logo: "https://storage.test/read/logo.png?token=l", ground: [255, 255, 255] }] };
const SLOT: SlotResult = { slot: { x: 466, y: 60, width: 150, height: 44 }, from: "drawn", of: "stored", index: 0, frame: [1088, 1360], canvas: { x: 468, y: 54, width: 152, height: 44 }, drawn: { x: 466, y: 60, width: 150, height: 44 }, score: 0.96, matched: "stored", scores: [0.96] };
const fileBody: SlotFileRequest = { job: "job-1", step: "marks", picture: "https://storage.test/read/nologo.png?token=n", rect: SLOT.slot, frame: [1088, 1360], of: "stored", files: [{ file: "stored", logo: "https://storage.test/read/logo.png?token=l" }], drawn: { file: "stored", ground: [255, 255, 255] } };
const FILE: SlotFileResult = { ground: [250, 250, 250], flat: 0.98, file: "stored", rect: SLOT.slot, shows: { stored: 14.2 }, drawn: { score: 0.31, found: false } };

/** How far a search got after `row` rows, as a service says it. */
const point = (row: number): SearchSoFar => ({ of: "0123456789abcdef0123456789abcdef", done: [], at: { size: 3, row, best: { x: 4, y: 2, width: 22, height: 9, score: 0.38 } } });

type Sent = { route: string; budget: string | undefined; from: SearchSoFar | null };
const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

/** A picture service: `answer` says what it answers to each call, from what the call sent. Every call is recorded. */
function service(answer: (sent: Sent, n: number) => Response) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    const call: Sent = { route: String(url).split("/").pop()!, budget: h["x-socialytics-budget"], from: h["x-socialytics-from"] ? JSON.parse(h["x-socialytics-from"]) : null };
    sent.push(call);
    return answer(call, sent.length);
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

/**
 * One request of the design worker for the row's job, with the steps as the
 * worker has them: locate asks for the slot of the design, marks asks for
 * the file of the cleaned picture, each through slotSearch, and each answers
 * "next" when the service did not finish. `requestSteps` is how many steps
 * the request has time for.
 */
async function request(r: ReturnType<typeof jobRow>, fetchImpl: typeof fetch, requestSteps = Infinity): Promise<void> {
  const job = r.read();
  let n = 0;
  const admin = { ...r.admin, rpc: async () => ({ data: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, error: null }) };
  const deps = { fetchImpl, sleep: async () => {} };
  let steps = 0;
  const runStep = async (): Promise<StepResult> => {
    steps++;
    const s = job.state as Record<string, unknown>;
    if (job.step === "locate") {
      const { result } = await slotSearch(admin, s, "slot", s.design_path as string, slotBody, deps);
      if (!result) return "next";
      s.logo_rect = result.slot;
      job.step = "marks";
      return "next";
    }
    const { result } = await slotSearch(admin, s, "slot-file", s.nologo_path as string, fileBody, deps);
    if (!result) return "next";
    s.logo_named = result.file;
    job.step = "finish";
    return "wait";
  };
  await advanceDesignJob(admin, job, runStep, () => steps < requestSteps);
}

const row = (step = "locate") => jobRow({ step, state: { design_path: DESIGN, nologo_path: CLEANED } });

describe("a slot the service did not finish within its time", () => {
  it("spends no try, keeps how far the service got, and ends in the result when the step asks again from there", async () => {
    // Three calls use their time, each a few rows further; the fourth ends the search.
    const s = service((_sent, n) => (n < 4 ? json(200, { ok: true, unfinished: { search: point(n * 10) }, ms: 20_003 }) : json(200, { ok: true, result: SLOT, ms: 7_100 })));
    const r = row();
    await request(r, s.fetchImpl, 4);
    expect(s.sent.map((c) => c.route)).toEqual(["slot", "slot", "slot", "slot"]);
    // Every call carries the budget; each after the first carries the point the call before it was answered, as it was answered.
    expect(s.sent.every((c) => c.budget === String(PICTURE_WORK_BUDGET_MS))).toBe(true);
    expect(s.sent.map((c) => c.from)).toEqual([null, point(10), point(20), point(30)]);
    // The job moved on with no try spent and no error, and nothing of the search is left on it.
    expect(r.row).toMatchObject({ status: "running", step: "marks", attempts: 0, error: null });
    expect(r.row.state).toEqual({ design_path: DESIGN, nologo_path: CLEANED, logo_rect: SLOT.slot });
  });

  it("carries the search over from one request of the worker to the next: the row holds the point between them", async () => {
    const s = service((_sent, n) => (n < 3 ? json(200, { ok: true, unfinished: { search: point(n * 10) }, ms: 20_003 }) : json(200, { ok: true, result: SLOT, ms: 7_100 })));
    const r = row();
    // The first request has time for one step only.
    await request(r, s.fetchImpl, 1);
    expect(r.row).toMatchObject({ status: "running", step: "locate", attempts: 0, error: null, lease_until: null });
    expect(r.row.state[SEARCH_KEPT.slot]).toEqual({ of: DESIGN, search: point(10), asks: 1 });
    // The next pass picks the job up and carries on from the row.
    await request(r, s.fetchImpl, 1);
    expect(r.row.state[SEARCH_KEPT.slot]).toEqual({ of: DESIGN, search: point(20), asks: 2 });
    await request(r, s.fetchImpl, 1);
    expect(s.sent.map((c) => c.from)).toEqual([null, point(10), point(20)]);
    expect(r.row).toMatchObject({ step: "marks", attempts: 0 });
    expect(r.row.state).not.toHaveProperty(SEARCH_KEPT.slot);
  });

  it("does the same for the cleaned slot's file", async () => {
    const s = service((sent, n) => (sent.route === "slot-file" && n < 3 ? json(200, { ok: true, unfinished: { search: point(n) }, ms: 20_001 }) : json(200, { ok: true, result: FILE, ms: 900 })));
    const r = row("marks");
    await request(r, s.fetchImpl, 1);
    expect(r.row.state[SEARCH_KEPT["slot-file"]]).toEqual({ of: CLEANED, search: point(1), asks: 1 });
    expect(r.row).toMatchObject({ step: "marks", attempts: 0, error: null });
    await request(r, s.fetchImpl);
    expect(s.sent.map((c) => [c.route, c.from])).toEqual([["slot-file", null], ["slot-file", point(1)], ["slot-file", point(2)]]);
    expect(r.row).toMatchObject({ step: "finish", attempts: 0 });
    expect(r.row.state).toEqual({ design_path: DESIGN, nologo_path: CLEANED, logo_named: "stored" });
  });

  it("is answered by a service from before the budget as it always was: the whole result on the first call", async () => {
    // A service that reads neither header works to its end, however long, and answers the result.
    const s = service((sent) => json(200, { ok: true, result: sent.route === "slot" ? SLOT : FILE, ms: 29_700 }));
    const r = row();
    await request(r, s.fetchImpl);
    expect(s.sent.map((c) => c.route)).toEqual(["slot", "slot-file"]);
    expect(r.row).toMatchObject({ step: "finish", attempts: 0, error: null });
    expect(r.row.state).toEqual({ design_path: DESIGN, nologo_path: CLEANED, logo_rect: SLOT.slot, logo_named: "stored" });
  });

  it("waits, with no try spent and the point kept, for a service that is unavailable or does not have the route yet", async () => {
    const r = jobRow({ step: "locate", state: { design_path: DESIGN, [SEARCH_KEPT.slot]: { of: DESIGN, search: point(40), asks: 2 } } });
    const down = service(() => json(503, { ok: false, reason: "A picture could not be read from storage." }));
    await request(r, down.fetchImpl);
    expect(r.row).toMatchObject({ status: "running", step: "locate", attempts: 0, lease_until: null });
    expect(r.row.error).toContain("The picture service did not answer");
    expect(r.row.state[SEARCH_KEPT.slot]).toEqual({ of: DESIGN, search: point(40), asks: 2 });
    const notYet = service(() => json(404, { ok: false, reason: "Unknown route." }));
    await request(r, notYet.fetchImpl);
    expect(r.row).toMatchObject({ status: "running", attempts: 0, error: "The picture service does not have this route yet." });
    expect(r.row.state[SEARCH_KEPT.slot]).toEqual({ of: DESIGN, search: point(40), asks: 2 });
  });
});

describe("the hard cap on asking again", () => {
  /** A service that uses its time on every call that sends a budget and never gets further, and (as the real one does) works a call with no budget to its end. */
  const never = (endless = false) => service((sent) => (sent.budget || endless ? json(200, { ok: true, unfinished: { search: point(1) }, ms: 20_000 }) : json(200, { ok: true, result: SLOT, ms: 58_000 })));

  it("asks PICTURE_MAX_ASKS times with a budget, then once with none, which the service works to its end", async () => {
    const s = never();
    const r = row();
    // One request with all the time it wants: the step answers "next" again and again, and the loop still ends.
    await request(r, s.fetchImpl, PICTURE_MAX_ASKS + 1);
    expect(s.sent).toHaveLength(PICTURE_MAX_ASKS + 1);
    expect(s.sent.slice(0, PICTURE_MAX_ASKS).every((c) => c.budget === String(PICTURE_WORK_BUDGET_MS))).toBe(true);
    // The call after the last budget: no budget, and still the point the search had reached.
    expect(s.sent[PICTURE_MAX_ASKS]).toEqual({ route: "slot", budget: undefined, from: point(1) });
    expect(r.row).toMatchObject({ step: "marks", attempts: 0, error: null });
    expect(r.row.state).not.toHaveProperty(SEARCH_KEPT.slot);
  });

  it("ends a job whose every call is answered unfinished, whatever was sent: a try is spent at each cap and the job fails on its last", async () => {
    // A service that breaks the contract and answers unfinished even to a call with no budget.
    const s = never(true);
    const r = row();
    for (let pass = 1; pass <= MAX_DESIGN_ATTEMPTS; pass++) {
      // Each request runs until the step stops answering "next" by itself; a request that never ended would fail the test by its timeout.
      await request(r, s.fetchImpl);
      expect(s.sent, `pass ${pass}`).toHaveLength(pass * (PICTURE_MAX_ASKS + 1));
      expect(r.row.attempts).toBe(pass);
      expect(r.row.error).toBe("The picture service answered something it should not have.");
      // The refused call leaves nothing kept: the next try searches from the beginning, with its calls uncounted.
      expect(r.row.state).not.toHaveProperty(SEARCH_KEPT.slot);
    }
    expect(r.row.status).toBe("failed");
    // The most calls one design's slot can ever cost.
    expect(s.sent).toHaveLength(MAX_DESIGN_ATTEMPTS * (PICTURE_MAX_ASKS + 1));
    await request(r, s.fetchImpl);
    expect(r.row.status).toBe("failed");
  });

  it("counts a new design's search from nothing: what was kept for another picture is not sent", async () => {
    const state: Record<string, unknown> = { [SEARCH_KEPT.slot]: { of: DESIGN, search: point(30), asks: PICTURE_MAX_ASKS } };
    expect(searchKept(state, "slot", DESIGN)).toEqual({ search: point(30), asks: PICTURE_MAX_ASKS });
    expect(searchKept(state, "slot", "c1/canva-finish/job-1/design-2.png")).toBeNull();
    expect(searchKept(state, "slot-file", DESIGN)).toBeNull();
    expect(searchKept({}, "slot", DESIGN)).toBeNull();
    expect(searchKept(null, "slot", DESIGN)).toBeNull();
    expect(searchKept({ [SEARCH_KEPT.slot]: "x" }, "slot", DESIGN)).toBeNull();
    // An unfinished answer is kept with the picture it is of; a result leaves nothing.
    expect(searchWorked(state, "slot", "c1/canva-finish/job-1/design-2.png", { unfinished: { search: point(2) }, carried: { search: point(2), asks: 1 }, ms: 20_000 })).toBeNull();
    expect(state[SEARCH_KEPT.slot]).toEqual({ of: "c1/canva-finish/job-1/design-2.png", search: point(2), asks: 1 });
    expect(searchWorked(state, "slot", "c1/canva-finish/job-1/design-2.png", { result: SLOT, ms: 3_000 })).toEqual(SLOT);
    expect(state).toEqual({});
  });

  it("is cleared with everything else found on a design when a new design is made", () => {
    for (const key of Object.values(SEARCH_KEPT)) expect(OF_THE_DESIGN).toContain(key);
  });
});

describe("the cleaned slot with the first picture, when the service did not finish within its time", () => {
  const BASE = "c1/canva-finish/job-1";
  const COMPOSED = { made: true, share: 0.02, join: 1.5, box: { x: 440, y: 40, width: 200, height: 90 } };
  type Body = { first?: string; out?: string };

  /** The marks step's call as the design worker makes it: the first picture's two fields when a picture is to be composed, through slotSearch. */
  function asking(state: Record<string, unknown>, answer: (sent: Sent & { body: Body }, n: number) => Response) {
    const calls: Array<Sent & { body: Body }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      const call = { route: String(url).split("/").pop()!, budget: h["x-socialytics-budget"], from: h["x-socialytics-from"] ? JSON.parse(h["x-socialytics-from"]) : null, body: JSON.parse(String(init.body)) as Body };
      calls.push(call);
      return answer(call, calls.length);
    }) as unknown as typeof fetch;
    let n = 0;
    const admin = { rpc: async () => ({ data: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, error: null }) };
    const ask = () => askCleanedSlot<SlotFileResult>(state, BASE, (compose) =>
      slotSearch(admin, state, "slot-file", state.nologo_path as string, { ...fileBody, ...(compose ? { first: "https://storage.test/read/design.png?token=d", out: "https://storage.test/upload/composed.png?token=w" } : {}) }, { fetchImpl, sleep: async () => {} }));
    return { calls, ask };
  }
  const fresh = (): Record<string, unknown> => ({ design_path: DESIGN, nologo_path: CLEANED, generations: 1, unlogos: 1, logo_slot: { from: "drawn" } });

  it("keeps nothing about the composed picture until the call that ends the search, asks the same request again, and then keeps where it is", async () => {
    const state = fresh();
    const s = asking(state, (_sent, n) => (n < 3 ? json(200, { ok: true, unfinished: { search: point(n) }, ms: 20_002 }) : json(200, { ok: true, result: { ...FILE, composed: COMPOSED }, ms: 800 })));
    for (const n of [1, 2]) {
      expect((await s.ask()).result).toBeNull();
      // Nothing is known about composing yet: the cleaned picture is still the base, and the search's point is on the job.
      expect(state).not.toHaveProperty("composed");
      expect(basePicture(state)).toBe(CLEANED);
      expect(state[SEARCH_KEPT["slot-file"]]).toEqual({ of: CLEANED, search: point(n), asks: n });
    }
    expect((await s.ask()).result).toEqual({ ...FILE, composed: COMPOSED });
    // Every call asked for the composed picture, and each after the first carried on from the one before.
    expect(s.calls.every((c) => c.body.first && c.body.out)).toBe(true);
    expect(s.calls.map((c) => c.from)).toEqual([null, point(1), point(2)]);
    expect(state.composed).toEqual({ of: CLEANED, path: `${BASE}/composed-1-1.png`, share: 0.02, join: 1.5, box: COMPOSED.box });
    expect(basePicture(state)).toBe(`${BASE}/composed-1-1.png`);
    expect(state).not.toHaveProperty(SEARCH_KEPT["slot-file"]);
  });

  it("asks a service from before the first picture again without the two fields, from the beginning", async () => {
    const state = fresh();
    state[SEARCH_KEPT["slot-file"]] = { of: CLEANED, search: point(5), asks: 2 };
    // That service refuses the fields it does not know (its own 400) and reads no budget.
    const s = asking(state, (sent) => (sent.body.first ? json(400, { ok: false, reason: "The request is not well formed: first" }) : json(200, { ok: true, result: FILE, ms: 24_000 })));
    expect((await s.ask()).result).toEqual(FILE);
    expect(s.calls.map((c) => [!!c.body.first, c.from])).toEqual([[true, point(5)], [false, null]]);
    expect(state.composed).toEqual({ of: CLEANED, path: null, why: "service" });
    expect(basePicture(state)).toBe(CLEANED);
  });
});

