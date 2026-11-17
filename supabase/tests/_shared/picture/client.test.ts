// @vitest-environment node
// Node, not jsdom: the client sets AbortSignal.timeout, which jsdom lacks and Deno has.
import { describe, expect, it, vi } from "vitest";
import { NotEnded, NotInStorage, PictureError, callPicture, callPictureWithin, carriedOf, notePicture, pictureCheckCount, searchToEnd, signedRead, signedWrite, type Carried } from "../../../functions/_shared/picture/client";
import { PICTURE_CALL_TIMEOUT_MS, PICTURE_MAX_ASKS, PICTURE_OPEN_TIMEOUT_MS, PICTURE_SEARCH_ROUTES, PICTURE_WORK_BUDGET_MS, type FinishRequest, type LocateRequest, type LocateResult, type PostLogosRequest, type SearchSoFar, type SlotFileRequest, type SlotFileResult, type SlotRequest, type SlotResult } from "../../../functions/_shared/picture/contract";

const body: FinishRequest = {
  job: "job-1",
  step: "finish",
  picture: "https://storage.test/read/nologo.png?token=r",
  logo: "https://storage.test/read/logo.png?token=l",
  rect: { x: 980, y: 2240, width: 370, height: 370 },
  frame: [2176, 2720],
  output: { width: 1440, height: 1800 },
  out: "https://storage.test/upload/final.png?token=w",
};
const result = { picture: { width: 2176, height: 2720 }, output: { width: 1440, height: 1800 }, bytes: 1234 };

/** A fake fetch that answers the prepared responses in turn (an Error is thrown) and records each call. */
function fakeFetch(answers: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error("no answer prepared");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
/** A fake database that opens a call per request (an Error is thrown, null is the database's own error) and records each id it gave. */
function db(answers?: Array<string | Error | null>) {
  const opened: string[] = [];
  const rpc = vi.fn(async (_name: string) => {
    const next = answers ? answers.shift() : undefined;
    if (next instanceof Error) throw next;
    if (next === null) return { data: null, error: { message: "could not connect" } };
    const id = next ?? `00000000-0000-4000-8000-00000000000${opened.length + 1}`;
    opened.push(id);
    return { data: id, error: null };
  });
  return { admin: { rpc }, rpc, opened };
}
const answer = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
const timeout = () => Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });

async function failure(p: Promise<unknown>): Promise<PictureError> {
  try {
    await p;
  } catch (e) {
    return e as PictureError;
  }
  throw new Error("expected the call to fail");
}

describe("callPicture", () => {
  it("opens a call in the database, posts the body to the route with the call's id and answers the result and its time", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, result, ms: 812 })]);
    const sleep = vi.fn(async () => {});
    const { admin, rpc, opened } = db();
    const got = await callPicture(admin, "finish", body, { fetchImpl, baseUrl: "https://pictures.test", sleep });
    expect(got).toEqual({ result, ms: 812 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("open_picture_call");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://pictures.test/api/picture/finish");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ "content-type": "application/json", "x-socialytics-call": opened[0] });
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("calls the app's own Vercel project when no address is given", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, result, ms: 1 })]);
    await callPicture(db().admin, "finish", body, { fetchImpl, sleep: async () => {} });
    expect(calls[0].url).toBe("https://moburst-socialytics.vercel.app/api/picture/finish");
  });

  it("opens a new call for the retry, so no attempt sends an id the service has already claimed", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(503, { ok: false, reason: "down" }), answer(200, { ok: true, result, ms: 640 })]);
    const { admin, rpc, opened } = db();
    await callPicture(admin, "finish", body, { fetchImpl, sleep: async () => {} });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
    expect(calls.map((c) => (c.init.headers as Record<string, string>)["x-socialytics-call"])).toEqual(opened);
  });

  it("fails at once, with the service's reason, when the service says it could not work", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(200, { ok: false, reason: "A picture could not be read from storage." })]);
    const sleep = vi.fn(async () => {});
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl, sleep }));
    expect(e).toBeInstanceOf(PictureError);
    expect(e.message).toBe("A picture could not be read from storage.");
    expect(e.route).toBe("finish");
    // The service ran and could not work with the picture: said apart from a refusal of the call.
    expect(e.why).toBe("unusable");
    expect(e.transient).toBe(false);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry a refusal, and says so without the call's id", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(401, { ok: false, reason: "Not allowed." })]);
    const sleep = vi.fn(async () => {});
    const { admin, opened } = db();
    const e = await failure(callPicture(admin, "finish", body, { fetchImpl, sleep }));
    expect(e.message).toBe("The picture service refused the call (401): Not allowed.");
    expect(e.message).not.toContain(opened[0]);
    expect(e.message).not.toContain("storage.test");
    expect(e.why).toBe("refused");
    expect(e.transient).toBe(false);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("carries the service's own reason with the status of a refusal, and does not retry it", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(400, { ok: false, reason: "The request is not well formed: rect" })]);
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl, sleep: async () => {} }));
    expect(e.message).toBe("The picture service refused the call (400): The request is not well formed: rect.");
    expect(e.status).toBe(400);
    expect(e.transient).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("keeps the service's own answer for an unknown route as a refusal", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(404, { ok: false, reason: "Unknown route." })]);
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl, sleep: async () => {} }));
    expect(e.message).toBe("The picture service refused the call (404): Unknown route.");
    expect(e.why).toBe("refused");
    // The status is kept, so a worker can tell a route the service does not have yet from a call it turned away.
    expect(e.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("waits when the answer did not come from the service: a page from the platform in its place, as before the function's first deploy", async () => {
    // What the app's Vercel project answered a POST under /api/picture before the function existed (read 16 Nov 2026): 405 and a page.
    const page = (status: number) => new Response("<!doctype html><html></html>", { status, headers: { "content-type": "text/html; charset=utf-8" } });
    for (const status of [401, 403, 404, 405]) {
      const { calls, fetchImpl } = fakeFetch([page(status), page(status)]);
      const sleep = vi.fn(async () => {});
      const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl, sleep }));
      expect(e.message).toBe(`The picture service did not answer: ${status}.`);
      expect(e.why).toBe("unavailable");
      expect(e.transient).toBe(true);
      expect(calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledWith(2000);
    }
    // The function arrives between the two tries: the call goes on.
    const arrived = fakeFetch([page(405), answer(200, { ok: true, result, ms: 9 })]);
    expect(await callPicture(db().admin, "finish", body, { fetchImpl: arrived.fetchImpl, sleep: async () => {} })).toEqual({ result, ms: 9 });
  });

  it("never carries a link in a reason, refusal or ok false", async () => {
    const leaky = "Could not read https://storage.test/read/nologo.png?token=r for this job.";
    const refused = fakeFetch([answer(400, { ok: false, reason: leaky })]);
    const a = await failure(callPicture(db().admin, "finish", body, { fetchImpl: refused.fetchImpl, sleep: async () => {} }));
    expect(a.message).toBe("The picture service refused the call (400): Could not read a link for this job.");
    const notOk = fakeFetch([answer(200, { ok: false, reason: leaky })]);
    const b = await failure(callPicture(db().admin, "finish", body, { fetchImpl: notOk.fetchImpl, sleep: async () => {} }));
    expect(b.message).toBe("Could not read a link for this job.");
    expect(b.message).not.toContain("token");
  });

  it("retries once after two seconds when the service is busy or down, then gives up", async () => {
    const recovered = fakeFetch([answer(503, { ok: false, reason: "down" }), answer(200, { ok: true, result, ms: 640 })]);
    const sleep = vi.fn(async () => {});
    expect(await callPicture(db().admin, "finish", body, { fetchImpl: recovered.fetchImpl, sleep })).toEqual({ result, ms: 640 });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(recovered.calls).toHaveLength(2);

    const down = fakeFetch([answer(503, { ok: false, reason: "down" }), answer(503, { ok: false, reason: "down" })]);
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl: down.fetchImpl, sleep: async () => {} }));
    expect(e).toBeInstanceOf(PictureError);
    expect(e.message).toBe("The picture service did not answer: 503 (down).");
    expect(e.transient).toBe(true);
    expect(down.calls).toHaveLength(2);
  });

  it("carries the service's own reason from its last answer when it is still unavailable, and still waits", async () => {
    const storage = fakeFetch([answer(503, { ok: false, reason: "The first answer's reason." }), answer(503, { ok: false, reason: "A picture could not be read from storage." })]);
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl: storage.fetchImpl, sleep: async () => {} }));
    expect(e.message).toBe("The picture service did not answer: 503 (A picture could not be read from storage).");
    expect(e.why).toBe("unavailable");
    expect(e.transient).toBe(true);
    expect(storage.calls).toHaveLength(2);

    // A link in the reason is named, never copied.
    const leaky = fakeFetch([answer(503, { ok: false, reason: "down" }), answer(503, { ok: false, reason: "Could not read https://storage.test/read/nologo.png?token=r right now." })]);
    const l = await failure(callPicture(db().admin, "finish", body, { fetchImpl: leaky.fetchImpl, sleep: async () => {} }));
    expect(l.message).toBe("The picture service did not answer: 503 (Could not read a link right now).");
    expect(l.message).not.toContain("token");
    expect(l.why).toBe("unavailable");
  });

  it("names only the status of an unavailable answer whose body is not the service's JSON", async () => {
    const page = () => new Response("<html>Service Unavailable</html>", { status: 502, headers: { "content-type": "text/html" } });
    const { calls, fetchImpl } = fakeFetch([page(), page()]);
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl, sleep: async () => {} }));
    expect(e.message).toBe("The picture service did not answer: 502.");
    expect(e.why).toBe("unavailable");
    expect(calls).toHaveLength(2);
  });

  it("tries again when a 2xx answer's body is cut off or times out while it is read, and waits when it happens twice", async () => {
    // The headers arrived with 200, then the body failed: the call never got its answer.
    const cut = (error: Error) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":true,"result":{"pic'));
        controller.error(error);
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
    const terminated = () => new TypeError("terminated");

    const recovered = fakeFetch([cut(terminated()), answer(200, { ok: true, result, ms: 700 })]);
    const sleep = vi.fn(async () => {});
    expect(await callPicture(db().admin, "finish", body, { fetchImpl: recovered.fetchImpl, sleep })).toEqual({ result, ms: 700 });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(recovered.calls).toHaveLength(2);

    const network = fakeFetch([cut(terminated()), cut(terminated())]);
    const n = await failure(callPicture(db().admin, "finish", body, { fetchImpl: network.fetchImpl, sleep: async () => {} }));
    expect(n.message).toBe("The picture service did not answer: network.");
    expect(n.why).toBe("unavailable");
    expect(n.transient).toBe(true);
    expect(network.calls).toHaveLength(2);

    const slow = fakeFetch([cut(timeout()), cut(timeout())]);
    const t = await failure(callPicture(db().admin, "finish", body, { fetchImpl: slow.fetchImpl, sleep: async () => {} }));
    expect(t.message).toBe("The picture service did not answer: timeout.");
    expect(t.why).toBe("unavailable");
    expect(slow.calls).toHaveLength(2);
  });

  it("refuses a 2xx answer whose body reads fine but is not the service's JSON, without a retry", async () => {
    const { calls, fetchImpl } = fakeFetch([new Response("<html>OK</html>", { status: 200, headers: { "content-type": "text/html" } })]);
    const sleep = vi.fn(async () => {});
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl, sleep }));
    expect(e.message).toBe("The picture service answered something it should not have.");
    expect(e.why).toBe("refused");
    expect(e.transient).toBe(false);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("treats a timeout as a transient failure", async () => {
    const { calls, fetchImpl } = fakeFetch([timeout(), timeout()]);
    const sleep = vi.fn(async () => {});
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl, sleep }));
    expect(e.message).toBe("The picture service did not answer: timeout.");
    expect(e.transient).toBe(true);
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("does not call the service when the database cannot open a call, tries once more, and counts the service as unavailable", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, result, ms: 1 })]);
    const sleep = vi.fn(async () => {});
    // The database's own error, then a failure to reach it at all.
    const { admin, rpc } = db([null, new Error("fetch failed")]);
    const e = await failure(callPicture(admin, "finish", body, { fetchImpl, sleep }));
    expect(e).toBeInstanceOf(PictureError);
    expect(e.message).toBe("The picture service was not called: the database could not open a call.");
    expect(e.why).toBe("unavailable");
    expect(e.transient).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(calls).toHaveLength(0);
  });

  it("goes on when the call opens on the second try", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, result, ms: 5 })]);
    const { admin, opened } = db([null, "00000000-0000-4000-8000-0000000000b2"]);
    expect(await callPicture(admin, "finish", body, { fetchImpl, sleep: async () => {} })).toEqual({ result, ms: 5 });
    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>)["x-socialytics-call"]).toBe(opened[0]);
  });

  it("gives the database five seconds to open a call, then counts it as not opened, so a database that hangs cannot hang the step", async () => {
    expect(PICTURE_OPEN_TIMEOUT_MS).toBe(5_000);
    const { calls, fetchImpl } = fakeFetch([]);
    const rpc = vi.fn(() => new Promise<never>(() => {}));
    const started = Date.now();
    const e = await failure(callPicture({ rpc }, "finish", body, { fetchImpl, sleep: async () => {}, openTimeoutMs: 20 }));
    expect(e.message).toBe("The picture service was not called: the database could not open a call.");
    expect(e.transient).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not take an answer that is not an id for an open call", async () => {
    const { calls, fetchImpl } = fakeFetch([]);
    const admin = { rpc: async () => ({ data: "", error: null }) };
    const e = await failure(callPicture(admin, "finish", body, { fetchImpl, sleep: async () => {} }));
    expect(e.message).toBe("The picture service was not called: the database could not open a call.");
    expect(calls).toHaveLength(0);
  });
});

describe("callPictureWithin", () => {
  const locate: LocateRequest = { job: "job-1", step: "locate", design: "https://storage.test/read/design.png?token=d", logo: "https://storage.test/read/logo.png?token=l", background: [255, 255, 255], placement: { anchor: "center", width: 0.2, top: 0.04 }, scales: [0.45, 1.35] };
  const found: LocateResult = { x: 466, y: 60, width: 150, height: 44, score: 0.96, usual: { x: 468, y: 54, width: 152, height: 44 }, frame: [1088, 1360] };
  const soFar: SearchSoFar = { of: "0123456789abcdef0123456789abcdef", done: [{ x: 10, y: 12, width: 40, height: 16, score: 0.4123456789012345 }], at: { size: 7, row: 12, best: { x: 4, y: 2, width: 22, height: 9, score: -2 } } };
  const posts: PostLogosRequest = { job: "c1", step: "design_settings", posts: ["https://storage.test/read/a.jpg?token=a", "https://storage.test/read/b.jpg?token=b"], placement: locate.placement, scales: [0.45, 1.35], searches: [{ file: "stored", logo: "https://storage.test/read/logo.png?token=l", ground: [255, 255, 255] }], compare: [] };
  const slot: SlotRequest = { job: "job-1", step: "locate", design: locate.design, placement: locate.placement, scales: [0.45, 1.35], templates: [{ file: "stored", logo: "https://storage.test/read/logo.png?token=l", ground: [255, 255, 255] }] };
  const slotFound: SlotResult = { slot: { x: 466, y: 60, width: 150, height: 44 }, from: "drawn", of: "stored", index: 0, frame: [1088, 1360], canvas: { x: 468, y: 54, width: 152, height: 44 }, drawn: { x: 466, y: 60, width: 150, height: 44 }, score: 0.96, matched: "stored", scores: [0.96] };
  const slotFile: SlotFileRequest = { job: "job-1", step: "marks", picture: "https://storage.test/read/nologo.png?token=n", rect: slotFound.slot, frame: [1088, 1360], of: "stored", files: [{ file: "stored", logo: "https://storage.test/read/logo.png?token=l" }], drawn: { file: "stored", ground: [255, 255, 255] } };
  const fileFound: SlotFileResult = { ground: [250, 250, 250], flat: 0.98, file: "stored", rect: slotFound.slot, shows: { stored: 14.2 }, drawn: { score: 0.31, found: false } };
  const headersOf = (c: { init: RequestInit }) => c.init.headers as Record<string, string>;

  it("sends the time the service may work, and nothing else new: the body is the one the route has always had", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, result: found, ms: 2100 })]);
    const { admin, opened } = db();
    const got = await callPictureWithin(admin, "locate", locate, null, { fetchImpl, baseUrl: "https://pictures.test" });
    expect(got).toEqual({ result: found, ms: 2100 });
    expect(calls[0].url).toBe("https://pictures.test/api/picture/locate");
    expect(calls[0].init.headers).toEqual({ "content-type": "application/json", "x-socialytics-call": opened[0], "x-socialytics-budget": String(PICTURE_WORK_BUDGET_MS) });
    expect(JSON.parse(String(calls[0].init.body))).toEqual(locate);
    // The budget leaves most of the call's own limit for the claim, the reads and the answer.
    expect(PICTURE_WORK_BUDGET_MS).toBeLessThanOrEqual(PICTURE_CALL_TIMEOUT_MS / 3);
  });

  it("answers how far the service got when its time was used, and sends that back exactly as it was given", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_007 }), answer(200, { ok: true, result: found, ms: 3100 })]);
    const { admin } = db();
    const first = await callPictureWithin(admin, "locate", locate, null, { fetchImpl });
    // What to keep: the point, and one call spent on this search.
    expect(first).toEqual({ unfinished: { search: soFar }, carried: { search: soFar, asks: 1 }, ms: 20_007 });
    if (!("unfinished" in first)) throw new Error("expected an unfinished answer");
    const second = await callPictureWithin(admin, "locate", locate, first.carried, { fetchImpl });
    expect(second).toEqual({ result: found, ms: 3100 });
    const sent = headersOf(calls[1])["x-socialytics-from"];
    // Every digit of a score comes back: the search carries on from the very number it stopped at.
    expect(JSON.parse(sent)).toEqual(soFar);
    expect(sent).toContain("0.4123456789012345");
    expect(headersOf(calls[0])["x-socialytics-from"]).toBeUndefined();
  });

  it("asks for the slot and for the cleaned slot's file the way it asks for locate: the budget out, how far it got back, and the result at the end", async () => {
    for (const [route, request, result] of [["slot", slot, slotFound], ["slot-file", slotFile, fileFound]] as const) {
      const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_004 }), answer(200, { ok: true, result, ms: 2_900 })]);
      const { admin } = db();
      const first = await callPictureWithin(admin, route, request as never, null, { fetchImpl, baseUrl: "https://pictures.test" });
      expect(first, route).toEqual({ unfinished: { search: soFar }, carried: { search: soFar, asks: 1 }, ms: 20_004 });
      if (!("unfinished" in first)) throw new Error("expected an unfinished answer");
      expect(await callPictureWithin(admin, route, request as never, first.carried, { fetchImpl, baseUrl: "https://pictures.test" }), route).toEqual({ result, ms: 2_900 });
      expect(calls.map((c) => c.url)).toEqual([`https://pictures.test/api/picture/${route}`, `https://pictures.test/api/picture/${route}`]);
      expect(headersOf(calls[0])["x-socialytics-budget"]).toBe(String(PICTURE_WORK_BUDGET_MS));
      expect(JSON.parse(headersOf(calls[1])["x-socialytics-from"])).toEqual(soFar);
      // The body of both calls is the request the route has always had.
      for (const c of calls) expect(JSON.parse(String(c.init.body))).toEqual(request);
    }
    expect([...PICTURE_SEARCH_ROUTES].sort()).toEqual(["locate", "post-logos", "slot", "slot-file"]);
  });

  it("answers the posts a read finished and the point of the next one", async () => {
    const part = { posts: [{ found: false, score: 0.31 }], search: soFar };
    const { fetchImpl } = fakeFetch([answer(200, { ok: true, unfinished: part, ms: 20_002 })]);
    expect(await callPictureWithin(db().admin, "post-logos", posts, null, { fetchImpl })).toEqual({ unfinished: part, carried: { search: soFar, asks: 1 }, ms: 20_002 });
  });

  it("is answered by a service from before the budget exactly as callPicture is: the whole result", async () => {
    // A service that reads neither header works to its end and answers `result`, whichever route is asked.
    const whole = { posts: [{ found: false, score: 0.31 }, null] };
    const old = fakeFetch([answer(200, { ok: true, result: whole, ms: 47_000 }), answer(200, { ok: true, result: slotFound, ms: 29_700 }), answer(200, { ok: true, result: fileFound, ms: 24_000 })]);
    expect(await callPictureWithin(db().admin, "post-logos", posts, { search: soFar, asks: 3 }, { fetchImpl: old.fetchImpl })).toEqual({ result: whole, ms: 47_000 });
    expect(await callPictureWithin(db().admin, "slot", slot, null, { fetchImpl: old.fetchImpl })).toEqual({ result: slotFound, ms: 29_700 });
    expect(await callPictureWithin(db().admin, "slot-file", slotFile, null, { fetchImpl: old.fetchImpl })).toEqual({ result: fileFound, ms: 24_000 });
    // The headers it does not read went with a body it has always read.
    expect(JSON.parse(String(old.calls[1].init.body))).toEqual(slot);
  });

  it("sends the same budget and the same point with the retry of a call that did not arrive, and counts the two as one call", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(503, { ok: false, reason: "A picture could not be read from storage." }), answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_000 })]);
    const sleep = vi.fn(async () => {});
    const { admin, opened } = db();
    const got = await callPictureWithin(admin, "locate", locate, { search: soFar, asks: 4 }, { fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(2);
    for (const c of calls) {
      expect(headersOf(c)["x-socialytics-budget"]).toBe(String(PICTURE_WORK_BUDGET_MS));
      expect(JSON.parse(headersOf(c)["x-socialytics-from"])).toEqual(soFar);
    }
    expect(got).toMatchObject({ carried: { asks: 5 } });
  });

  it("keeps the point it had when an unfinished answer names none", async () => {
    const { fetchImpl } = fakeFetch([answer(200, { ok: true, unfinished: {}, ms: 20_000 })]);
    expect(await callPictureWithin(db().admin, "slot", slot, { search: soFar, asks: 2 }, { fetchImpl })).toEqual({ unfinished: {}, carried: { search: soFar, asks: 3 }, ms: 20_000 });
  });

  it("fails as callPicture does: unavailable is waited out, a refusal and an unusable picture are told apart", async () => {
    const down = fakeFetch([timeout(), timeout()]);
    expect((await failure(callPictureWithin(db().admin, "locate", locate, null, { fetchImpl: down.fetchImpl, sleep: async () => {} }))).why).toBe("unavailable");
    const refused = fakeFetch([answer(400, { ok: false, reason: "The request is not well formed: x-socialytics-budget" })]);
    expect((await failure(callPictureWithin(db().admin, "locate", locate, null, { fetchImpl: refused.fetchImpl }))).why).toBe("refused");
    const unusable = fakeFetch([answer(200, { ok: false, reason: "The file is not a picture that can be read." })]);
    expect((await failure(callPictureWithin(db().admin, "locate", locate, null, { fetchImpl: unusable.fetchImpl }))).why).toBe("unusable");
  });

  it("refuses an answer that has neither a result nor how far the call got", async () => {
    const { fetchImpl } = fakeFetch([answer(200, { ok: true, ms: 5 })]);
    const e = await failure(callPictureWithin(db().admin, "locate", locate, null, { fetchImpl }));
    expect(e.why).toBe("refused");
    expect(e.message).toBe("The picture service answered something it should not have.");
  });

  describe("the hard cap on asking again", () => {
    it("sends no budget once a search has had its calls with one, and still says how far the search got", async () => {
      const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, result: slotFound, ms: 41_000 })]);
      const got = await callPictureWithin(db().admin, "slot", slot, { search: soFar, asks: PICTURE_MAX_ASKS }, { fetchImpl });
      expect(got).toEqual({ result: slotFound, ms: 41_000 });
      expect(headersOf(calls[0])["x-socialytics-budget"]).toBeUndefined();
      expect(JSON.parse(headersOf(calls[0])["x-socialytics-from"])).toEqual(soFar);
      // The call before it, the last with a budget.
      const last = fakeFetch([answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_000 })]);
      expect(await callPictureWithin(db().admin, "slot", slot, { search: soFar, asks: PICTURE_MAX_ASKS - 1 }, { fetchImpl: last.fetchImpl })).toMatchObject({ carried: { asks: PICTURE_MAX_ASKS } });
      expect(headersOf(last.calls[0])["x-socialytics-budget"]).toBe(String(PICTURE_WORK_BUDGET_MS));
    });

    it("refuses an unfinished answer to that call, so a service that never finishes cannot be asked without end", async () => {
      const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_000 })]);
      const e = await failure(callPictureWithin(db().admin, "slot-file", slotFile, { search: soFar, asks: PICTURE_MAX_ASKS }, { fetchImpl }));
      expect(e.why).toBe("refused");
      expect(e.transient).toBe(false);
      expect(calls).toHaveLength(1);
    });

    it("ends a search asked for until it ends, against a service that answers unfinished every time: PICTURE_MAX_ASKS calls with a budget, one without, then a failure", async () => {
      // Each call gets the same point back: a service that makes no progress at all.
      const calls: Array<Record<string, string>> = [];
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        calls.push(init.headers as Record<string, string>);
        return answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_000 });
      }) as unknown as typeof fetch;
      const e = await failure(searchToEnd(db().admin, "slot", () => slot, { fetchImpl }));
      expect(e.why).toBe("refused");
      expect(calls).toHaveLength(PICTURE_MAX_ASKS + 1);
      expect(calls.slice(0, PICTURE_MAX_ASKS).every((h) => h["x-socialytics-budget"] === String(PICTURE_WORK_BUDGET_MS))).toBe(true);
      expect(calls[PICTURE_MAX_ASKS]["x-socialytics-budget"]).toBeUndefined();
    });

    it("gives the result, the calls it took and the longest of them when the search ends", async () => {
      const { fetchImpl } = fakeFetch([answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_004 }), answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_010 }), answer(200, { ok: true, result: slotFound, ms: 6_000 })]);
      expect(await searchToEnd(db().admin, "slot", async () => slot, { fetchImpl })).toEqual({ result: slotFound, ms: 20_010, total: 46_014, calls: 3 });
    });

    it("leaves a search where it is when its caller's own time is up, after the call in progress", async () => {
      const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_004 }), answer(200, { ok: true, unfinished: { search: soFar }, ms: 20_004 }), answer(200, { ok: true, result: slotFound, ms: 6_000 })]);
      let looks = 0;
      // The caller's time is up at its second look: two calls were made, the third never.
      const e = await searchToEnd(db().admin, "slot", () => slot, { fetchImpl }, () => ++looks >= 2).catch((err) => err);
      expect(e).toBeInstanceOf(NotEnded);
      expect(calls).toHaveLength(2);
      // A caller whose time is already up still makes the first call: a check always asks once.
      const once = fakeFetch([answer(200, { ok: true, result: slotFound, ms: 6_000 })]);
      expect(await searchToEnd(db().admin, "slot", () => slot, { fetchImpl: once.fetchImpl }, () => true)).toMatchObject({ result: slotFound, calls: 1 });
    });

    it("is small enough to end and large enough for the slowest search measured", () => {
      // Twelve budgets are four minutes of the service's time on one search; the slowest search measured took 51 seconds.
      expect(PICTURE_MAX_ASKS).toBe(12);
      expect(PICTURE_MAX_ASKS * PICTURE_WORK_BUDGET_MS).toBeGreaterThanOrEqual(4 * 51_000);
    });
  });

  it("reads back what a caller kept, and takes anything else for a first call", () => {
    const kept: Carried = { search: soFar, asks: 3 };
    expect(carriedOf(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(carriedOf(null)).toBeNull();
    expect(carriedOf("x")).toBeNull();
    expect(carriedOf({ asks: "many" })).toEqual({ asks: 0 });
    expect(carriedOf({ search: soFar })).toEqual({ search: soFar, asks: 0 });
    expect(carriedOf({ search: 7, asks: 2.9 })).toEqual({ asks: 2 });
  });
});

describe("callPicture and a call that was not finished", () => {
  it("refuses an unfinished answer to a call that sent no budget, since only a budget can be answered that way", async () => {
    const { calls, fetchImpl } = fakeFetch([answer(200, { ok: true, unfinished: { posts: [] }, ms: 5 })]);
    const e = await failure(callPicture(db().admin, "finish", body, { fetchImpl }));
    expect(e.why).toBe("refused");
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].init.headers as Record<string, string>).sort()).toEqual(["content-type", "x-socialytics-call"]);
  });
});

describe("signed URLs", () => {
  it("asks storage for a 600 second read link and an upserting upload link", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://storage.test/read" }, error: null }));
    const createSignedUploadUrl = vi.fn(async () => ({ data: { signedUrl: "https://storage.test/upload" }, error: null }));
    const from = vi.fn(() => ({ createSignedUrl, createSignedUploadUrl }));
    const admin = { storage: { from } };
    expect(await signedRead(admin, "canva-finish", "c/design-1.png")).toBe("https://storage.test/read");
    expect(await signedWrite(admin, "canva-finish", "c/final-x.png")).toBe("https://storage.test/upload");
    expect(from).toHaveBeenCalledWith("canva-finish");
    expect(createSignedUrl).toHaveBeenCalledWith("c/design-1.png", 600);
    expect(createSignedUploadUrl).toHaveBeenCalledWith("c/final-x.png", { upsert: true });
  });
  it("names the file when storage gives no link", async () => {
    const admin = { storage: { from: () => ({
      createSignedUrl: async () => ({ data: null, error: { message: "Object not found" } }),
      createSignedUploadUrl: async () => ({ data: null, error: null }),
    }) } };
    await expect(signedRead(admin, "b", "c/missing.png")).rejects.toThrow("Could not prepare c/missing.png for the picture service: Object not found");
    await expect(signedWrite(admin, "b", "c/out.png")).rejects.toThrow("Could not prepare c/out.png for the picture service: no URL");
  });
  it("says a file is not in storage only when storage answered and refused its path", async () => {
    const withError = (error: Record<string, unknown>) => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error }) }) } });
    // Storage answered: the file is not there.
    for (const status of [400, 404]) {
      const refused = await signedRead(withError({ message: "Object not found", status }), "b", "c/gone.jpg").catch((e) => e);
      expect(refused).toBeInstanceOf(NotInStorage);
      expect(refused.message).toBe("Could not prepare c/gone.jpg for the picture service: Object not found");
    }
    // Storage could not answer right now, or said nothing of why: never taken as a missing file.
    for (const error of [{ message: "fetch failed" }, { message: "busy", status: 429 }, { message: "timeout", status: 408 }, { message: "bad gateway", status: 502 }]) {
      const failed = await signedRead(withError(error), "b", "c/a.jpg").catch((e) => e);
      expect(failed).toBeInstanceOf(Error);
      expect(failed).not.toBeInstanceOf(NotInStorage);
    }
  });
});

describe("notePicture", () => {
  it("keeps the last duration of each route on the job's state", () => {
    const state: any = {};
    notePicture(state, "locate", 300);
    notePicture(state, "finish", 900);
    notePicture(state, "locate", 410);
    expect(state.picture_ms).toEqual({ locate: 410, finish: 900 });
  });
});

describe("pictureCheckCount", () => {
  it("is 3 when no usable count is given", () => {
    expect(pictureCheckCount(undefined)).toBe(3);
    expect(pictureCheckCount(null)).toBe(3);
    expect(pictureCheckCount("many")).toBe(3);
    expect(pictureCheckCount(Number.NaN)).toBe(3);
  });

  it("is a whole number from 1 to 40", () => {
    expect(pictureCheckCount(12)).toBe(12);
    expect(pictureCheckCount("7")).toBe(7);
    expect(pictureCheckCount(2.9)).toBe(2);
    expect(pictureCheckCount(0)).toBe(1);
    expect(pictureCheckCount(-5)).toBe(1);
    expect(pictureCheckCount(0.5)).toBe(1);
    expect(pictureCheckCount(41)).toBe(40);
    expect(pictureCheckCount(Number.POSITIVE_INFINITY)).toBe(40);
  });
});
