// @vitest-environment node
// server/test/budget.test.ts
//
// What holds for every call whatever its pictures cost (17 Nov 2026): a
// read or a write never fails because of how long the work before it took;
// one long call does not keep another from reading and answering; a call
// that sends a budget answers when its time is used, with how far it got,
// and the same request with that point carries on to the same result; a
// call that sends no budget is answered as it always was. All of it holds
// for every route that searches: locate, post-logos, the slot and the
// cleaned slot's file. The last part runs the workers' own client against
// the service, for a worker and a service of the same age and of different
// ages. The searches here are real ones (a 40x16 logo on a 240x180 picture,
// a tenth of a second or more on a laptop). The three tests that need a
// search to last, whatever the machine, use the slow shape: a 480x360
// picture whose logo is usually small on it, so the first pass runs on the
// picture at full size and takes several times as long.

import { describe, expect, it } from "vitest";
import { canvasLogoRect } from "../../supabase/functions/_shared/canva/brief.ts";
import { callPicture, callPictureWithin, searchToEnd, type PictureDeps } from "../../supabase/functions/_shared/picture/client.ts";
import { PICTURE_BUDGET_HEADER, PICTURE_CALL_HEADER, PICTURE_CALL_TIMEOUT_MS, PICTURE_FROM_HEADER, PICTURE_MAX_ASKS, PICTURE_WORK_BUDGET_MS, type LocateResult, type Placement, type PostLogo, type SearchSoFar, type SlotFileRequest, type SlotFileResult, type SlotRequest, type SlotResult, type Unfinished } from "../../supabase/functions/_shared/picture/contract.ts";
import { SEARCH_STEPS_VERSION } from "../../supabase/functions/_shared/design/logoMatch.ts";
import { box, drawLogo, flat, inked, mark } from "../../supabase/tests/_shared/design/draw.ts";
import { createApp } from "../src/app.ts";
import { CLAIM_TIMEOUT_MS } from "../src/call.ts";
import { composeForSlot } from "../src/picture/compose.ts";
import { encodePng, type Raster } from "../src/picture/raster.ts";
import { TURN_MS } from "../src/picture/routes.ts";
import { findSlot, slotFile } from "../src/picture/slot.ts";
import { STORAGE_TIMEOUT_MS, storageTime } from "../src/storage.ts";
import { pagePicture } from "./fixtures.ts";

const BIG = 60_000;
const CALL = "5f0c2f6e-8a1b-4c3d-9e2f-1a2b3c4d5e6f";
const STORAGE = "https://store.test/";
const GET = `${STORAGE}get/`;
const PUT = `${STORAGE}put/`;

type Answer = { status: number; json: { ok: boolean; result?: unknown; unfinished?: Unfinished; reason?: string; ms?: number } };

/**
 * A fake storage that behaves like the real one where it matters here: a
 * read or a write whose time limit has already run out fails, as fetch does
 * with a signal that is aborted. `onGet` runs before a file is served (to
 * move the service's clock, or to make storage slow or busy for one file).
 */
function harness(files: Record<string, Uint8Array>, options: { storageTimeoutMs?: number; clock?: () => number; onGet?: (name: string) => Promise<Response | void> | Response | void; onPut?: (name: string) => Response | void; searchVersion?: number } = {}) {
  const lines: Record<string, unknown>[] = [];
  const fetched: string[] = [];
  /** Every write storage took, in order, with its bytes. */
  const puts: Array<{ name: string; bytes: Buffer }> = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.signal?.aborted) throw init.signal.reason;
    if ((init?.method ?? "GET") === "PUT") {
      const refused = options.onPut?.(url.slice(PUT.length));
      if (refused) return refused;
      puts.push({ name: url.slice(PUT.length), bytes: Buffer.from(await new Response(init?.body).arrayBuffer()) });
      return new Response("{}", { status: 200 });
    }
    const name = url.slice(GET.length);
    fetched.push(name);
    const given = await options.onGet?.(name);
    if (given) return given;
    if (init?.signal?.aborted) throw init.signal.reason;
    const bytes = files[name];
    return bytes ? new Response(bytes, { status: 200 }) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  const app = createApp({ claimCall: async () => true, fetchImpl: fake, log: (line) => lines.push(line), storage: STORAGE, storageTimeoutMs: options.storageTimeoutMs, clock: options.clock, searchVersion: options.searchVersion });
  async function call(route: string, body: unknown, headers: Record<string, string> = {}): Promise<Answer> {
    const res = await app.request(`/api/picture/${route}`, { method: "POST", headers: { [PICTURE_CALL_HEADER]: CALL, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Answer["json"] };
  }
  /**
   * The service as the workers' client reaches it: a fetch that goes to the
   * app, and a database that opens a call. `sent` records the two headers of
   * each call. With `old`, the service is one from before the budget: it
   * reads neither header, so they are taken off before the app sees them.
   */
  function reached(old = false) {
    const sent: Array<{ route: string; budget: string | undefined; from: boolean }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const headers = { ...(init.headers as Record<string, string>) };
      sent.push({ route: new URL(url).pathname.split("/").pop()!, budget: headers[PICTURE_BUDGET_HEADER], from: PICTURE_FROM_HEADER in headers });
      if (old) {
        delete headers[PICTURE_BUDGET_HEADER];
        delete headers[PICTURE_FROM_HEADER];
      }
      return app.request(new URL(url).pathname, { method: init.method, headers, body: init.body });
    }) as unknown as typeof fetch;
    const admin = { rpc: async () => ({ data: CALL, error: null }) };
    const deps: PictureDeps = { fetchImpl, baseUrl: "https://pictures.test", sleep: async () => {} };
    return { admin, deps, sent };
  }
  return { lines, fetched, puts, call, reached };
}

const budget = (ms: number, from?: SearchSoFar) => ({ [PICTURE_BUDGET_HEADER]: String(ms), ...(from ? { [PICTURE_FROM_HEADER]: JSON.stringify(from) } : {}) });

// One client's posts: its logo drawn in white on a dark ground, at different spots, and one post with no logo.
const set = { job: "client-1", step: "design_settings" };
const W = 240, H = 180;
const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
const scales: [number, number] = [0.45, 1.35];
const shape = mark(40, 16, [24, 28, 40]);
const usual = canvasLogoRect(placement, 40, 16, W, H);
const at = (dx: number, dy: number, k: number) => ({ x: usual.x + dx, y: usual.y + dy, width: Math.round(usual.width * k), height: Math.round((usual.width * k * 16) / 40) });
const searches = [{ file: "stored", logo: `${GET}stored.png`, ground: [255, 255, 255] }, { file: "other", logo: `${GET}other.png`, ground: [11, 14, 26] }];
const POSTS = ["p0.png", "p1.png", "p2.png", "p3.png"];
async function clientFiles(): Promise<Record<string, Uint8Array>> {
  return {
    "stored.png": await encodePng(shape),
    "other.png": await encodePng(inked(shape, [255, 255, 255])),
    "p0.png": await encodePng(drawLogo(flat(W, H, [16, 40, 76]), shape, at(6, 4, 0.8), [255, 255, 255])),
    "p1.png": await encodePng(pagePicture(W, H, 7)),
    "p2.png": await encodePng(drawLogo(flat(W, H, [40, 20, 60]), shape, at(-5, 7, 1.1), [255, 255, 255])),
    "p3.png": await encodePng(drawLogo(flat(W, H, [250, 250, 250]), shape, at(2, -3, 0.9))),
    "tiny.png": await encodePng(pagePicture(8, 8, 1)),
  };
}
const postsBody = (names: string[]) => ({ ...set, posts: names.map((n) => `${GET}${n}`), placement, scales, searches, compare: [] });

// The slow shape: the same logo carried at an eighth of a 480x360 picture's width, so the first pass tries every spot of the full picture.
const BW = 480, BH = 360;
const small: Placement = { anchor: "left", left: 0.1875, width: 0.125, top: 0.125 };
const smallUsual = canvasLogoRect(small, 40, 16, BW, BH);
const bigAt = (dx: number, dy: number) => ({ x: smallUsual.x + dx, y: smallUsual.y + dy, width: smallUsual.width, height: smallUsual.height });
async function slowFiles(): Promise<Record<string, Uint8Array>> {
  return {
    ...(await clientFiles()),
    "big0.png": await encodePng(drawLogo(flat(BW, BH, [16, 40, 76]), shape, bigAt(9, 6), [255, 255, 255])),
    "big1.png": await encodePng(drawLogo(flat(BW, BH, [40, 20, 60]), shape, bigAt(-7, 11), [255, 255, 255])),
  };
}
const slowPosts = { ...set, posts: [`${GET}big0.png`, `${GET}big1.png`], placement: small, scales, searches, compare: [] };
const slowSlot = { job: "job-1", step: "locate", design: `${GET}big0.png`, placement: small, scales, templates: searches };
const locateBody = { job: "job-1", step: "locate", design: `${GET}p0.png`, placement, scales, templates: searches, compare: [] };

describe("a call's time in storage", () => {
  it("counts only the time spent reading and writing, so the work between two reads costs it nothing", async () => {
    const inStorage = storageTime(60);
    const stopped: boolean[] = [];
    await inStorage(async (limit) => { stopped.push(limit.aborted); });
    // The call works on its pictures for longer than its whole time in storage.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await inStorage(async (limit) => {
      // The second read still has its time: it can wait for storage a while and is not stopped.
      await new Promise((resolve) => setTimeout(resolve, 20));
      stopped.push(limit.aborted);
    });
    expect(stopped).toEqual([false, false]);
    // Time spent in storage itself is counted: after a read that took the whole time, the next one has none left.
    await inStorage((limit) => new Promise<void>((resolve) => limit.addEventListener("abort", () => resolve())));
    await expect(inStorage((limit) => new Promise<void>((_, reject) => limit.addEventListener("abort", () => reject(limit.reason))))).rejects.toBeDefined();
  });

  it("reads every post of a call whose searches run longer than its whole time in storage", async () => {
    // Each post takes about a second to search; storage answers at once. Until 17 Nov the time limit of the reads
    // was one timer started with the call, and the second post could not be read ("A picture could not be read from storage.").
    // Storage takes a moment to answer, as a real read does, so a limit that has run out is noticed.
    const { call, lines } = harness(await slowFiles(), { storageTimeoutMs: 150, onGet: () => new Promise<void>((resolve) => setTimeout(resolve, 2)) });
    const started = performance.now();
    const { status, json } = await call("post-logos", slowPosts);
    expect(performance.now() - started).toBeGreaterThan(150);
    expect(status).toBe(200);
    expect((json.result as { posts: PostLogo[] }).posts.map((p) => p?.found)).toEqual([true, true]);
    expect(lines[0]).toMatchObject({ ok: true, in: { post0: "480x360", post1: "480x360" } });
  }, BIG);

  it("still ends a call when storage itself does not answer within that time", async () => {
    const { call } = harness(await clientFiles(), { storageTimeoutMs: 30, onGet: (name) => (name === "p2.png" ? new Promise<void>((resolve) => setTimeout(resolve, 200)) : undefined) });
    expect(await call("post-logos", postsBody(["p2.png"]))).toEqual({ status: 503, json: { ok: false, reason: "A picture could not be read from storage." } });
  }, BIG);

  it("fits, with the time a call may work and the time its claim may take, inside the worker's limit for the call", () => {
    expect(CLAIM_TIMEOUT_MS + PICTURE_WORK_BUDGET_MS + STORAGE_TIMEOUT_MS).toBeLessThan(PICTURE_CALL_TIMEOUT_MS);
    expect(PICTURE_WORK_BUDGET_MS * 3).toBe(PICTURE_CALL_TIMEOUT_MS);
  });
});

describe("two calls in one instance", () => {
  it("lets a second call read its picture and answer while a long search runs", async () => {
    // The quick call's picture arrives 40 ms after it asked, when the long call is deep in its search.
    const { call } = harness(await slowFiles(), { onGet: (name) => (name === "tiny.png" ? new Promise<void>((resolve) => setTimeout(resolve, 40)) : undefined) });
    const order: string[] = [];
    const began = performance.now();
    let quickMs = 0;
    const long = call("post-logos", slowPosts).then((a) => { order.push("long"); return a; });
    const quick = call("transcode", { job: "job-2", step: "frame", picture: `${GET}tiny.png`, quality: 90, out: `${PUT}tiny.jpg` }).then((a) => { order.push("quick"); quickMs = performance.now() - began; return a; });
    const [a, b] = await Promise.all([long, quick]);
    const longMs = performance.now() - began;
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Until 17 Nov a search ran in one go and the quick call waited for all of it.
    expect(order).toEqual(["quick", "long"]);
    expect(quickMs).toBeLessThan(longMs / 2);
    expect(TURN_MS).toBeLessThanOrEqual(50);
  }, BIG);
});

describe("a call that works to a budget", () => {
  /** A clock the test moves: the service's working time is measured on it. */
  function clock() {
    let t = 1_000;
    return { now: () => t, move: (ms: number) => { t += ms; } };
  }

  it("answers the posts it finished when its time is used, and the rest asked again ends in the answer of one read of them all", async () => {
    const files = await clientFiles();
    // One read of all four, with no budget: the answer the posts have always had.
    const whole = (await harness(files).call("post-logos", postsBody(POSTS))).json.result as { posts: Array<PostLogo | null> };
    expect(whole.posts.map((p) => p?.found)).toEqual([true, false, true, true]);

    // The same posts under a budget. The clock moves 15 seconds as each post after the first is fetched, so the time is used in the third post.
    const time = clock();
    let slow = true;
    const { call, lines, fetched } = harness(files, { clock: time.now, onGet: (name) => { if (slow && (name === "p1.png" || name === "p2.png" || name === "p3.png")) time.move(15_000); } });
    const first = await call("post-logos", postsBody(POSTS), budget(20_000));
    expect(first.status).toBe(200);
    expect(first.json.result).toBeUndefined();
    const part = first.json.unfinished!;
    expect(part.posts).toEqual(whole.posts.slice(0, 2));
    // The third post was begun: how far its first search got comes back, and the fourth post was never fetched.
    expect(part.search).toMatchObject({ of: expect.stringMatching(/^[0-9a-f]{32}$/), done: [], at: { size: 0, row: 1 } });
    expect(fetched.filter((n) => n.startsWith("p"))).toEqual(["p0.png", "p1.png", "p2.png"]);
    expect(lines[0]).toMatchObject({ route: "post-logos", ok: true, budget: 20_000, unfinished: true, in: { post0: "240x180", post1: "240x180", post2: "240x180" } });

    // The step asks for the rest, with the point it was given. The clock stands still now, so the call ends.
    slow = false;
    const rest = await call("post-logos", postsBody(POSTS.slice(2)), budget(20_000, part.search));
    expect(rest.json.unfinished).toBeUndefined();
    expect([...part.posts!, ...(rest.json.result as { posts: Array<PostLogo | null> }).posts]).toEqual(whole.posts);
    expect(lines[1]).toMatchObject({ budget: 20_000, from: "used" });
    expect(lines[1]).not.toHaveProperty("unfinished");
  }, BIG);

  it("ends in the same answer when a search is cut into many calls", async () => {
    const files = await clientFiles();
    const whole = (await harness(files).call("locate", locateBody)).json.result as LocateResult;
    // The clock moves a millisecond every time it is read, so a call's time is used after a set number of steps:
    // one step for a budget of 1 ms, some hundreds of rows for 400 ms. The search is stopped again and again.
    const time = clock();
    const { call } = harness(files, { clock: () => { time.move(1); return time.now(); } });
    let from: SearchSoFar | undefined;
    let last: Answer | undefined;
    const seen: SearchSoFar[] = [];
    for (let i = 0; i < 60 && !last?.json.result; i++) {
      last = await call("locate", locateBody, budget(i % 2 ? 400 : 1, from));
      if (last.json.unfinished) { from = last.json.unfinished.search; seen.push(from!); }
    }
    expect(seen.length).toBeGreaterThan(4);
    expect(last!.json.result).toEqual(whole);
    // It was stopped in the first template and in the second.
    expect(seen.some((s) => s.done.length === 0)).toBe(true);
    expect(seen.some((s) => s.done.length === 1)).toBe(true);
  }, BIG);

  it("always gets further than the call before, even when its time is used before it starts", async () => {
    const time = clock();
    const { call } = harness(await clientFiles(), { clock: time.now, onGet: () => time.move(30_000) });
    const a = await call("locate", locateBody, budget(1_000));
    const b = await call("locate", locateBody, budget(1_000, a.json.unfinished!.search));
    expect(a.json.unfinished!.search!.at).toMatchObject({ size: 0, row: 1 });
    expect(b.json.unfinished!.search!.at).toMatchObject({ size: 0, row: 2 });
  }, BIG);

  it("gets further with every call whose time is used before it starts, through the first pass and the levels after it, and ends in the same answer", async () => {
    // A logo usually drawn at half the picture's width: the picture is shrunk for the first pass, so the search has finer levels after it.
    const wide: Placement = { anchor: "left", left: 0.1, width: 0.5, top: 0.125 };
    const spot = canvasLogoRect(wide, 40, 16, W, H);
    const files = { ...(await clientFiles()), "wide.png": await encodePng(drawLogo(pagePicture(W, H, 11), shape, { x: spot.x + 4, y: spot.y + 6, width: spot.width, height: spot.height })) };
    // The request of a job with one file: the shape locate has always had.
    const body = { job: "job-1", step: "locate", design: `${GET}wide.png`, placement: wide, scales: [0.9, 1.1], logo: `${GET}stored.png`, background: [255, 255, 255] };
    const whole = (await harness(files).call("locate", body)).json.result as LocateResult;
    expect(whole.score).toBeGreaterThan(0.9);

    // Every call finds its time used when its pictures are read. Each must still leave the search further than it found it, or end it.
    const time = clock();
    const { call } = harness(files, { clock: time.now, onGet: () => time.move(30_000) });
    const order = (s: SearchSoFar) => s.done.length * 1e9 + (s.at ? s.at.size * 1e4 + s.at.row : 0);
    let from: SearchSoFar | undefined;
    let last: Answer | undefined;
    let calls = 0, afterFirstPass = 0;
    while (!last?.json.result && calls < 600) {
      last = await call("locate", body, budget(1_000, from));
      calls++;
      const next = last.json.unfinished?.search;
      if (!next) continue;
      if (from) expect(order(next), `call ${calls}`).toBeGreaterThan(order(from));
      // A point with every size done and no row begun is the end of the first pass.
      if (from && next.at && from.at && next.at.size > from.at.size && next.at.row === 0) afterFirstPass++;
      from = next;
    }
    expect(last!.json.result).toEqual(whole);
    // It was stopped once at the end of its first pass, and the call that carried on from there ended it.
    expect(afterFirstPass).toBe(1);
    expect(calls).toBeGreaterThan(50);
  }, BIG);

  it("starts from the beginning when the point it is given is of another search, or cannot be read", async () => {
    const files = await clientFiles();
    const whole = (await harness(files).call("locate", locateBody)).json.result as LocateResult;
    const time = clock();
    const stopped = harness(files, { clock: time.now, onGet: () => time.move(30_000) });
    const other = (await stopped.call("locate", { ...locateBody, design: `${GET}p2.png` }, budget(1_000))).json.unfinished!.search!;
    // A point of another design, with a best match that is not this design's: used, it would give another answer.
    const wrong: SearchSoFar = { ...other, done: [{ x: 1, y: 1, width: 30, height: 12, score: 0.99 }, { x: 1, y: 1, width: 30, height: 12, score: 0.99 }] };
    const { call, lines } = harness(files);
    expect((await call("locate", locateBody, budget(60_000, wrong))).json.result).toEqual(whole);
    expect(lines[0]).toMatchObject({ from: "not used" });
    const res = await call("locate", locateBody, { [PICTURE_BUDGET_HEADER]: "60000", [PICTURE_FROM_HEADER]: "{not json" });
    expect(res.json.result).toEqual(whole);
    expect(lines[1]).toMatchObject({ ok: true, from: "not used" });
  }, BIG);

  it("keeps the posts it finished when storage cannot serve a later one right now", async () => {
    const files = await clientFiles();
    const { call } = harness(files, { onGet: (name) => (name === "p2.png" ? new Response("bad gateway", { status: 502 }) : undefined) });
    const got = await call("post-logos", postsBody(["p0.png", "p2.png", "p3.png"]), budget(20_000));
    expect(got.status).toBe(200);
    expect(got.json.unfinished!.posts).toHaveLength(1);
    expect(got.json.unfinished!.search).toBeUndefined();
    // With no post finished there is nothing to keep: storage's own answer, which the worker waits out.
    expect(await call("post-logos", postsBody(["p2.png", "p3.png"]), budget(20_000))).toEqual({ status: 503, json: { ok: false, reason: "A picture could not be read from storage." } });
  }, BIG);

  it("refuses a budget that is not a whole number of milliseconds within the call limit, before anything is fetched", async () => {
    const { call, fetched } = harness({});
    for (const bad of ["0", "-5", "1.5", "soon", "60001", ""]) {
      expect(await call("locate", locateBody, { [PICTURE_BUDGET_HEADER]: bad }), bad).toEqual({ status: 400, json: { ok: false, reason: `The request is not well formed: ${PICTURE_BUDGET_HEADER}` } });
    }
    expect(fetched).toEqual([]);
  });
});

describe("a call that sends no budget", () => {
  it("works to its end however long that takes, and answers every post as before", async () => {
    // The clock runs a minute with every fetch: far past any budget, and no budget was sent.
    let t = 0;
    const { call, lines } = harness(await clientFiles(), { clock: () => t, onGet: () => { t += 60_000; } });
    const { status, json } = await call("post-logos", postsBody(POSTS));
    expect(status).toBe(200);
    expect(json.unfinished).toBeUndefined();
    expect((json.result as { posts: Array<PostLogo | null> }).posts).toHaveLength(4);
    expect(lines[0]).not.toHaveProperty("budget");
    expect(lines[0]).not.toHaveProperty("unfinished");
    expect(lines[0]).not.toHaveProperty("from");
  }, BIG);

  it("leaves the other routes alone: a budget sent to a route that does not search changes nothing", async () => {
    const { call, lines } = harness(await clientFiles());
    const got = await call("transcode", { job: "job-2", step: "frame", picture: `${GET}tiny.png`, quality: 90, out: `${PUT}tiny.jpg` }, { [PICTURE_BUDGET_HEADER]: "soon", [PICTURE_FROM_HEADER]: "x" });
    expect(got).toMatchObject({ status: 200, json: { ok: true, result: { size: { width: 8, height: 8 } } } });
    expect(lines[0]).not.toHaveProperty("budget");
  });
});

// One design: the client's logo drawn in white on a dark ground, searched for with two templates in either tone, and its cleaned picture.
const slotBody = { job: "job-1", step: "locate", design: `${GET}p0.png`, placement, scales, templates: searches };
const drawnAt = at(6, 4, 0.8);
const fileBody = { job: "job-1", step: "marks", picture: `${GET}p0.png`, rect: drawnAt, frame: [W, H], of: "stored", files: [{ file: "stored", logo: `${GET}stored.png` }, { file: "white", logo: `${GET}other.png`, last: true }], drawn: { file: "stored", ground: [255, 255, 255] } };
/** A clock that moves `step` ms every time it is read, so a call's time is used after a set number of steps. */
function ticking(step: number) {
  let t = 1_000;
  return () => { t += step; return t; };
}

describe("the slot and the cleaned slot's file work to a budget like every search", () => {
  it("ends the slot in the same answer when its search is cut into many calls, in the first template and in the second", async () => {
    const files = await clientFiles();
    const whole = (await harness(files).call("slot", slotBody)).json.result as SlotResult;
    expect(whole.from).toBe("drawn");
    const { call, lines } = harness(files, { clock: ticking(1) });
    let from: SearchSoFar | undefined;
    let last: Answer | undefined;
    const seen: SearchSoFar[] = [];
    for (let i = 0; i < 60 && !last?.json.result; i++) {
      last = await call("slot", slotBody, budget(i % 2 ? 400 : 1, from));
      if (last.json.unfinished) { from = last.json.unfinished.search; seen.push(from!); }
    }
    expect(seen.length).toBeGreaterThan(4);
    expect(last!.json.result).toEqual(whole);
    expect(seen.some((s) => s.done.length === 0)).toBe(true);
    expect(seen.some((s) => s.done.length === 1)).toBe(true);
    expect(lines[0]).toMatchObject({ route: "slot", ok: true, budget: 1, unfinished: true });
    expect(lines.at(-1)).toMatchObject({ route: "slot", ok: true, from: "used" });
  }, BIG);

  it("ends the cleaned slot's file in the same answer when the look for the drawing is cut into many calls", async () => {
    const files = await clientFiles();
    const whole = (await harness(files).call("slot-file", fileBody)).json.result as SlotFileResult;
    // The drawing is on this picture, so the look finds it: a real search with a real match.
    expect(whole.drawn).toMatchObject({ found: true });
    const { call, lines } = harness(files, { clock: ticking(1) });
    let from: SearchSoFar | undefined;
    let last: Answer | undefined;
    let stops = 0;
    for (let i = 0; i < 200 && !last?.json.result; i++) {
      last = await call("slot-file", fileBody, budget(i % 2 ? 40 : 1, from));
      if (last.json.unfinished) { from = last.json.unfinished.search; stops++; }
    }
    expect(stops).toBeGreaterThan(4);
    expect(last!.json.result).toEqual(whole);
    expect(lines[0]).toMatchObject({ route: "slot-file", ok: true, unfinished: true });
  }, BIG);

  it("gets further with every call of either route whose time is used before it starts", async () => {
    for (const [route, body] of [["slot", slotBody], ["slot-file", fileBody]] as const) {
      const time = { t: 1_000 };
      const { call } = harness(await clientFiles(), { clock: () => time.t, onGet: () => { time.t += 30_000; } });
      const a = await call(route, body, budget(1_000));
      const b = await call(route, body, budget(1_000, a.json.unfinished!.search));
      expect(a.json.unfinished!.search!.at, route).toMatchObject({ size: 0, row: 1 });
      expect(b.json.unfinished!.search!.at, route).toMatchObject({ size: 0, row: 2 });
    }
  }, BIG);

  it("answers a cleaned slot with no drawing to look for at once, whatever its budget: there is nothing to search", async () => {
    const time = { t: 0 };
    const { call } = harness(await clientFiles(), { clock: () => time.t, onGet: () => { time.t += 30_000; } });
    const { drawn: _drawn, ...plain } = fileBody;
    const got = await call("slot-file", plain, budget(1));
    expect(got.json.unfinished).toBeUndefined();
    expect(got.json.result).toHaveProperty("file");
    expect(got.json.result).not.toHaveProperty("drawn");
  }, BIG);

  it("does not carry a point from one route's search into another's", async () => {
    const files = await clientFiles();
    const whole = (await harness(files).call("slot-file", fileBody)).json.result as SlotFileResult;
    const time = { t: 1_000 };
    const stopped = harness(files, { clock: () => time.t, onGet: () => { time.t += 30_000; } });
    const ofSlot = (await stopped.call("slot", slotBody, budget(1_000))).json.unfinished!.search!;
    const { call, lines } = harness(files);
    expect((await call("slot-file", fileBody, budget(60_000, { ...ofSlot, at: { ...ofSlot.at!, best: { x: 1, y: 1, width: 30, height: 12, score: 0.99 } } }))).json.result).toEqual(whole);
    expect(lines[0]).toMatchObject({ from: "not used" });
  }, BIG);

  it("lets a second call read its picture and answer while a slot is searched for", async () => {
    const { call } = harness(await slowFiles(), { onGet: (name) => (name === "tiny.png" ? new Promise<void>((resolve) => setTimeout(resolve, 40)) : undefined) });
    const order: string[] = [];
    const long = call("slot", slowSlot).then((a) => { order.push("slot"); return a; });
    const quick = call("transcode", { job: "job-2", step: "frame", picture: `${GET}tiny.png`, quality: 90, out: `${PUT}tiny.jpg` }).then((a) => { order.push("quick"); return a; });
    const [a, b] = await Promise.all([long, quick]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(order).toEqual(["quick", "slot"]);
  }, BIG);
});

describe("a worker and a service of different ages", () => {
  const slotRequest = slotBody as unknown as SlotRequest;
  const fileRequest = fileBody as unknown as SlotFileRequest;
  /** The answers of the service's own work run in one go on the same pixels: what main answered before budgets (searchSame.test.ts ties these to the search as it was). */
  async function inOneGo() {
    const design = drawLogo(flat(W, H, [16, 40, 76]), shape, at(6, 4, 0.8), [255, 255, 255]);
    const stored = shape, other = inked(shape, [255, 255, 255]);
    return {
      slot: findSlot(design, [{ file: "stored", raster: stored, ground: [255, 255, 255] }, { file: "other", raster: other, ground: [11, 14, 26] }], placement, scales),
      file: slotFile(design, drawnAt, [W, H], "stored", [{ file: "stored", raster: stored }, { file: "white", raster: other, last: true }], { file: "stored", ground: [255, 255, 255] }),
    };
  }

  it("a new service answers a worker from before the budget exactly as before: the whole result, in one call, however long the work takes", async () => {
    const before = await inOneGo();
    // The clock runs a minute with every fetch, far past any budget. The old worker's call (callPicture) sends neither header.
    let t = 0;
    const { reached, lines } = harness(await clientFiles(), { clock: () => t, onGet: () => { t += 60_000; } });
    const { admin, deps, sent } = reached();
    expect(await callPicture(admin, "slot", slotRequest, deps)).toEqual({ result: before.slot, ms: expect.any(Number) });
    expect(await callPicture(admin, "slot-file", fileRequest, deps)).toEqual({ result: before.file, ms: expect.any(Number) });
    expect(sent).toEqual([{ route: "slot", budget: undefined, from: false }, { route: "slot-file", budget: undefined, from: false }]);
    for (const line of lines) {
      expect(line).toMatchObject({ ok: true });
      for (const key of ["budget", "from", "unfinished"]) expect(line).not.toHaveProperty(key);
    }
    // The answer's own shape is the one it always had: ok, result, ms.
    const raw = await harness(await clientFiles()).call("slot", slotBody);
    expect(Object.keys(raw.json).sort()).toEqual(["ms", "ok", "result"]);
    expect(raw.json.result).toEqual(before.slot);
  }, BIG);

  it("a new worker and a new service: a search longer than a budget takes several calls, spends no retry, and ends in the same result", async () => {
    const before = await inOneGo();
    // The clock moves 10 ms with every look at it: a budget of 20 seconds is used after about a thousand steps of a search.
    const { reached } = harness(await clientFiles(), { clock: ticking(10) });
    const { admin, deps, sent } = reached();
    const slot = await searchToEnd(admin, "slot", () => slotRequest, deps);
    expect(slot.result).toEqual(before.slot);
    expect(slot.calls).toBeGreaterThan(2);
    expect(slot.calls).toBeLessThanOrEqual(PICTURE_MAX_ASKS);
    const file = await searchToEnd(admin, "slot-file", () => fileRequest, deps);
    expect(file.result).toEqual(before.file);
    // Every call carried the budget, and each one after a search's first carried how far the one before got.
    expect(sent.every((c) => c.budget === String(PICTURE_WORK_BUDGET_MS))).toBe(true);
    expect(sent.filter((c) => c.route === "slot").map((c) => c.from)).toEqual([false, ...Array(slot.calls - 1).fill(true)]);
  }, BIG);

  it("a new worker and a service from before the budget: the headers are not read, and the first call answers the whole result", async () => {
    const before = await inOneGo();
    // The old service never looks at a clock for a budget; this one would stop within a few rows if it read the header.
    const { reached } = harness(await clientFiles(), { clock: ticking(2_000) });
    const { admin, deps, sent } = reached(true);
    expect(await callPictureWithin(admin, "slot", slotRequest, null, deps)).toEqual({ result: before.slot, ms: expect.any(Number) });
    expect(await callPictureWithin(admin, "slot-file", fileRequest, null, deps)).toEqual({ result: before.file, ms: expect.any(Number) });
    // The worker did send its budget both times; the answer came whole all the same.
    expect(sent).toEqual([{ route: "slot", budget: String(PICTURE_WORK_BUDGET_MS), from: false }, { route: "slot-file", budget: String(PICTURE_WORK_BUDGET_MS), from: false }]);
  }, BIG);

  it("the hard cap, end to end: a service too slow to finish in twelve budgets is asked a thirteenth time with none, and works to the end", async () => {
    const before = await inOneGo();
    // The clock moves 2 seconds with every look: a budget is used after about five rows, and the search has more than a thousand.
    const { reached } = harness(await clientFiles(), { clock: ticking(2_000) });
    const { admin, deps, sent } = reached();
    const slot = await searchToEnd(admin, "slot", () => slotRequest, deps);
    expect(slot.calls).toBe(PICTURE_MAX_ASKS + 1);
    expect(sent.slice(0, PICTURE_MAX_ASKS).every((c) => c.budget === String(PICTURE_WORK_BUDGET_MS))).toBe(true);
    // The last call: no budget, and the point the twelfth call reached, so the rows already done are not done again.
    expect(sent[PICTURE_MAX_ASKS]).toEqual({ route: "slot", budget: undefined, from: true });
    expect(slot.result).toEqual(before.slot);
  }, BIG);
});

describe("a point a search was stopped at belongs to the code that made it", () => {
  it("is carried on by the same version of the search, and restarts cleanly under another, with the full answer", async () => {
    const files = await clientFiles();
    const whole = (await harness(files).call("slot", slotBody)).json.result as SlotResult;
    // A call under this deploy's search stops after its first row and answers its point.
    const time = { t: 1_000 };
    const stopped = harness(files, { clock: () => time.t, onGet: () => { time.t += 30_000; } });
    const point = (await stopped.call("slot", slotBody, budget(1_000))).json.unfinished!.search!;
    // A best match that is not this design's: carried on, it would give another rectangle.
    const kept: SearchSoFar = { ...point, at: { ...point.at!, size: 20, best: { x: 1, y: 1, width: 30, height: 12, score: 0.99 } } };

    // The same version takes the point (and so gives the wrong answer the point was doctored to give: it was carried on).
    const same = harness(files);
    expect((await same.call("slot", slotBody, budget(60_000, kept))).json.result).not.toEqual(whole);
    expect(same.lines[0]).toMatchObject({ from: "used" });

    // A deploy whose search changed has another version: the point is not used, the search starts from the beginning and the answer is whole.
    const later = harness(files, { searchVersion: SEARCH_STEPS_VERSION + 1 });
    const got = await later.call("slot", slotBody, budget(60_000, kept));
    expect(got.json.unfinished).toBeUndefined();
    expect(got.json.result).toEqual(whole);
    expect(later.lines[0]).toMatchObject({ ok: true, from: "not used" });
    // The same for the cleaned slot's file and for locate: every route's mark carries the version.
    for (const [route, body] of [["slot-file", fileBody], ["locate", locateBody]] as const) {
      const full = (await harness(files).call(route, body)).json.result;
      const made = (await harness(files, { clock: () => time.t, onGet: () => { time.t += 30_000; } }).call(route, body, budget(1_000))).json.unfinished!.search!;
      const next = harness(files, { searchVersion: SEARCH_STEPS_VERSION + 1 });
      expect((await next.call(route, body, budget(60_000, { ...made, at: { ...made.at!, best: { x: 1, y: 1, width: 30, height: 12, score: 0.99 } } }))).json.result, route).toEqual(full);
      expect(next.lines[0], route).toMatchObject({ from: "not used" });
    }
    // The points of two versions differ in their mark alone.
    const other = (await harness(files, { clock: () => time.t, onGet: () => { time.t += 30_000; }, searchVersion: SEARCH_STEPS_VERSION + 1 }).call("slot", slotBody, budget(1_000))).json.unfinished!.search!;
    expect(other.of).not.toBe(point.of);
    expect({ ...other, of: point.of }).toEqual(point);
  }, BIG);
});

// The first picture as the base (firstPicture.test.ts has the rule's own tests): a design as first drawn, with the model's logo
// drawing in the slot, and its cleaned copy with a color cast of its own. The cleaned-slot call composes the two and reads the slot
// on the composed picture, the search for the drawing included.
const FW = 320, FH = 240;
const slotRect = { x: 66, y: 34, width: 64, height: 26 };
function firstPicture(): Raster {
  const r = flat(FW, FH, [98, 2, 73]);
  box(r, 220, 100, FW, 200, [20, 24, 30]);
  return drawLogo(r, mark(40, 16, [0, 0, 0]), slotRect, [255, 255, 255]);
}
function cleanedPicture(): Raster {
  const r = flat(FW, FH, [102, 8, 68]);
  box(r, 220, 100, FW, 200, [24, 30, 25]);
  return r;
}
async function firstFiles(): Promise<Record<string, Uint8Array>> {
  return { ...(await clientFiles()), "first.png": await encodePng(firstPicture()), "cleaned.png": await encodePng(cleanedPicture()) };
}
const plainBody = { job: "job-1", step: "marks", picture: `${GET}cleaned.png`, rect: slotRect, frame: [FW, FH], of: "stored", files: [{ file: "stored", logo: `${GET}stored.png` }, { file: "other", logo: `${GET}other.png` }], drawn: { file: "stored", ground: [255, 255, 255] } };
const composeBody = { ...plainBody, first: `${GET}first.png`, out: `${PUT}composed.png` };

describe("the cleaned slot with the first picture, in a search that takes several calls", () => {
  it("composes a picture from these two: the test is of a real composed picture", () => {
    expect(composeForSlot(firstPicture(), cleanedPicture(), slotRect, [FW, FH], true).facts.made).toBe(true);
  });

  it("stores the composed picture once, with the call that ends the search, and answers what one call answers", async () => {
    const files = await firstFiles();
    // One call with no budget: the answer and the stored picture a call has always given.
    const one = harness(files);
    const whole = (await one.call("slot-file", composeBody)).json.result as SlotFileResult;
    expect(whole.composed).toMatchObject({ made: true });
    expect(one.puts.map((p) => p.name)).toEqual(["composed.png"]);

    // The same request under budgets that the search outlasts again and again.
    const cut = harness(files, { clock: ticking(1) });
    let from: SearchSoFar | undefined;
    let last: Answer | undefined;
    let stops = 0;
    for (let i = 0; i < 200 && !last?.json.result; i++) {
      last = await cut.call("slot-file", composeBody, budget(i % 2 ? 40 : 1, from));
      if (last.json.unfinished) {
        from = last.json.unfinished.search;
        stops++;
        // A call that did not end the search stored nothing.
        expect(cut.puts, `call ${i}`).toEqual([]);
      }
    }
    expect(stops).toBeGreaterThan(3);
    // The call that ended it stored the picture, once, and it is the picture the one call stored, byte for byte.
    expect(cut.puts.map((p) => p.name)).toEqual(["composed.png"]);
    expect(cut.puts[0].bytes.equals(one.puts[0].bytes)).toBe(true);
    expect(last!.json.result).toEqual(whole);
    // Every call after the first carried on in the composed picture's search.
    expect(cut.lines.slice(1).every((l) => l.from === "used")).toBe(true);
    expect(cut.lines.at(-1)).toMatchObject({ ok: true, in: { picture: "320x240", first: "320x240" }, out: { out: expect.stringContaining("320x240") } });
    expect(cut.lines[0].out).toEqual({});
  }, BIG);

  it("does not make a usual call ask again: with the workers' budget the composing, the search and the store fit in one call", async () => {
    // The machine's own clock and the budget the workers send. Composing is no search and is not what a budget is for.
    const { call, puts, lines } = harness(await firstFiles());
    const got = await call("slot-file", composeBody, budget(PICTURE_WORK_BUDGET_MS));
    expect(got.json.unfinished).toBeUndefined();
    expect((got.json.result as SlotFileResult).composed).toMatchObject({ made: true });
    expect(puts).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty("unfinished");
  }, BIG);

  it("carries each picture's point on in that picture: a composed picture's never into the cleaned one, and a cleaned one's as the search a failed store went on to", async () => {
    const files = await firstFiles();
    const time = { t: 1_000 };
    const slow = () => harness(files, { clock: () => time.t, onGet: () => { time.t += 30_000; } });
    const ofComposed = (await slow().call("slot-file", composeBody, budget(1_000))).json.unfinished!.search!;
    const ofCleaned = (await slow().call("slot-file", plainBody, budget(1_000))).json.unfinished!.search!;
    expect(ofComposed.of).not.toBe(ofCleaned.of);
    const { call, lines, puts } = harness(files);
    // The composed picture's point with a request for the cleaned picture alone: another search, from the beginning.
    await call("slot-file", plainBody, budget(60_000, ofComposed));
    // The composed picture's point with its own request: carried on, and the picture is stored by this call, which ends the search.
    const composed = (await call("slot-file", composeBody, budget(60_000, ofComposed))).json.result as SlotFileResult;
    expect(composed.composed).toMatchObject({ made: true });
    expect(puts).toHaveLength(1);
    // The cleaned picture's point with a request for a composed one is what a call leaves that could not store the composed picture:
    // the next call carries on in the cleaned picture, composes and stores nothing again, and says why.
    const moved = (await call("slot-file", composeBody, budget(60_000, ofCleaned))).json.result as SlotFileResult;
    expect(moved.composed).toMatchObject({ made: false, why: "store" });
    expect(puts).toHaveLength(1);
    expect(lines.map((l) => l.from)).toEqual(["not used", "used", "used"]);
  }, BIG);

  it("reads the slot on the cleaned picture when the composed one cannot be stored, also when the search took several calls", async () => {
    const files = await firstFiles();
    const busy = { onPut: () => new Response("busy", { status: 503 }) };
    const whole = (await harness(files, busy).call("slot-file", composeBody)).json.result as SlotFileResult;
    expect(whole.composed).toMatchObject({ made: false, why: "store" });
    // What the cleaned picture alone gives, with the note of why nothing was composed.
    const { composed: _composed, ...rest } = whole;
    expect(rest).toEqual((await harness(files).call("slot-file", plainBody)).json.result);

    const cut = harness(files, { ...busy, clock: ticking(1) });
    let from: SearchSoFar | undefined;
    let last: Answer | undefined;
    for (let i = 0; i < 300 && !last?.json.result; i++) {
      last = await cut.call("slot-file", composeBody, budget(i % 2 ? 40 : 1, from));
      if (last.json.unfinished) from = last.json.unfinished.search;
    }
    expect(last!.json.result).toEqual(whole);
    expect(cut.puts).toEqual([]);
  }, BIG);

  it("answers a worker from before both, no budget and no first picture, exactly as before: the cleaned picture's slot in one call, nothing stored", async () => {
    const stored = mark(40, 16, [24, 28, 40]);
    const before = slotFile(cleanedPicture(), slotRect, [FW, FH], "stored", [{ file: "stored", raster: stored }, { file: "other", raster: inked(stored, [255, 255, 255]) }], { file: "stored", ground: [255, 255, 255] });
    // The clock runs a minute with every fetch, far past any budget: no budget was sent, so the call works to its end.
    let t = 0;
    const { reached, puts, lines } = harness(await firstFiles(), { clock: () => t, onGet: () => { t += 60_000; } });
    const { admin, deps, sent } = reached();
    const got = await callPicture(admin, "slot-file", plainBody as unknown as SlotFileRequest, deps);
    expect(got.result).toEqual(before);
    expect(got.result).not.toHaveProperty("composed");
    expect(sent).toEqual([{ route: "slot-file", budget: undefined, from: false }]);
    expect(puts).toEqual([]);
    for (const key of ["budget", "from", "unfinished"]) expect(lines[0]).not.toHaveProperty(key);
    // A worker that knows the first picture and not the budget: one call, the composed picture stored once, as main answered it.
    const first = await callPicture(admin, "slot-file", composeBody as unknown as SlotFileRequest, deps);
    expect(first.result.composed).toMatchObject({ made: true });
    expect(puts.map((p) => p.name)).toEqual(["composed.png"]);
  }, BIG);
});

