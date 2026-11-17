// server/src/picture/routes.ts
//
// The ten picture routes (canvas, locate, read, finish, transcode,
// title-read since 12 Nov 2026; logo-set and post-logos since 16 Nov; slot
// and slot-file since 17 Nov),
// mounted at PICTURE_API_BASE behind the door (app.ts). Every call has one
// shape: check the body, read and decode its pictures from storage, run the
// operation, encode and store the outputs, answer. A body that is not well formed answers 400 naming its
// first bad field; storage that cannot give or take a picture right now (a
// network error, a 429 or a 5xx) answers 503 with the reason, so the
// worker's retry covers it and the job waits; a picture storage refuses (a
// missing or expired object, a refused upload), or bytes that are not a
// picture, answer 200 with ok false and the reason, so the worker decides
// what that means for its job; anything else answers 500. Each
// answer is preceded by exactly one log line with the sizes in and out and
// never a URL (signed URLs carry tokens) or the call's id. A link that is not
// in the service's storage is a body that is not well formed.
//
// Three things hold for every call, whatever its pictures cost (17 Nov 2026):
//   A call's reads and writes share one time in storage, counted only while
//   storage is read or written (storage.ts, storageTime), so no read or
//   write fails because of how long the work before it took.
//   The work that can be long, the search for a logo, is stepwise (a row of
//   spots at a time, logoMatch.ts), and after TURN_MS of it the other calls
//   of this instance get a turn. One long call cannot keep another from
//   reading its pictures or answering. Every search of every route runs
//   through the one place that does this (Pace.search below): locate,
//   post-logos, the slot, and the look for the drawing in the cleaned slot.
//   Those four routes work to the time a call gives them in
//   PICTURE_BUDGET_HEADER, by this machine's own clock. When that time is
//   used first, the answer is `unfinished` with how far the search got and,
//   for post-logos, the posts that are finished; the same request with that
//   point in PICTURE_FROM_HEADER carries on from there and ends in the same
//   result. So a call's time does not depend on how many pictures it was
//   sent or on how slow this machine is. A call that sends no budget works
//   to its end and answers as it always did.

import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { z } from "zod";
import { PICTURE_BUDGET_HEADER, PICTURE_CALL_TIMEOUT_MS, PICTURE_FROM_HEADER, PICTURE_SEARCH_ROUTES, READ_JPEG_QUALITY, type FirstPictureFacts, type PictureRoute, type PictureResults, type SearchSoFar, type Size, type Unfinished } from "../../../supabase/functions/_shared/picture/contract.ts";
import { SEARCH_STEPS_VERSION } from "../../../supabase/functions/_shared/design/logoMatch.ts";
import { further, type CompareIn, type Searched, type TemplateIn } from "../../../supabase/functions/_shared/design/logoTone.ts";
import type { Log } from "../log.ts";
import { fetchBytes, putBytes, StorageError, storageTime, type Fetcher } from "../storage.ts";
import { generationCanvas } from "./canvas.ts";
import { composeForSlot } from "./compose.ts";
import { finishPicture } from "./finish.ts";
import { locateLogoSteps } from "./locate.ts";
import { locateTemplatesSteps, logoSet, postLogoSteps, UnusableLogo } from "./tone.ts";
import { findSlotSteps, slotFileSteps, type StampIn } from "./slot.ts";
import { decodeRaster, encodeJpeg, encodePng, type Raster } from "./raster.ts";
import { readPictures } from "./read.ts";
import { pictureSchemas, searchSoFar } from "./schemas.ts";
import { titleRead } from "./title.ts";

/**
 * `storage` is the one address the routes read from and write to;
 * `storageTimeoutMs` is how long one call's reads and writes may take
 * together; `clock` is this machine's own clock in milliseconds, which a
 * call's working time is measured on; `searchVersion` is the version of the
 * search's steps that every point's mark carries (SEARCH_STEPS_VERSION
 * unless a test gives its own).
 */
export type PictureRouteDeps = { fetchImpl: Fetcher; log: Log; now: () => number; storage: string; storageTimeoutMs: number; clock: () => number; searchVersion?: number };

/** The longest the service works on one call's steps before the other calls of this instance get a turn. */
export const TURN_MS = 20;

const NOT_WELL_FORMED = "The request is not well formed: ";
const NOT_FINISHED = "The picture service could not finish this call.";

/** A failure the worker is told about in the product's words: storage, or bytes that are not a picture. */
class Refusal extends Error {}

type Encoding = { type: "png" } | { type: "jpeg"; quality: number };
const PNG: Encoding = { type: "png" };
const READ_JPEG: Encoding = { type: "jpeg", quality: READ_JPEG_QUALITY };

/** A call that worked to its budget and did not finish: what it answers in place of a result. */
class NotFinished {
  constructor(readonly unfinished: Unfinished) {}
}

/**
 * How a call's stepwise work is run: with a turn for the other calls every
 * TURN_MS, and, for a call that sent a budget, only until its time is used.
 * It is the one place a search is run from, whatever the route.
 */
type Pace = {
  /** True when the call sent a budget. */
  budgeted: boolean;
  /** True once the call's time is used. Never true for a call with no budget. */
  over(): boolean;
  /** True when the point an earlier call sent is of the search with this mark. */
  carries(of: string): boolean;
  /**
   * Runs a search to its end, or to the call's budget. `of` marks what is
   * searched; the point an earlier call sent is used only when it carries
   * the same mark. It stops only at a point further than the one it began
   * from, so every call leaves the search further than it found it, or ends
   * it, even when its time was used before the search began.
   */
  search<T>(of: string, steps: (from: Searched | undefined) => Generator<Searched, T, void>): Promise<{ value: T } | { soFar: SearchSoFar }>;
};

/**
 * A mark of what a search is over: one short text for the parts that decide
 * it, and for the version of the search's own steps (logoMatch.ts,
 * SEARCH_STEPS_VERSION). A point made by other code than this deploy's has
 * another mark, so it is not carried on: the search starts from the
 * beginning.
 */
function markOfVersion(version: number, parts: unknown): string {
  return createHash("sha256").update(JSON.stringify([version, parts])).digest("hex").slice(0, 32);
}

const SEARCHES = new Set<PictureRoute>(PICTURE_SEARCH_ROUTES);

/** Reads inputs and writes outputs for one call, noting each size for the log line. */
type Io = {
  input(name: string, url: string): Promise<Raster>;
  /** A mark of the bytes an input was read as, for a call that works to a budget or carries on; empty otherwise. */
  mark(name: string): string;
  /** A picture the call can do without: null when storage refuses it (a missing or expired file) or its bytes are not a picture. Storage that cannot answer right now still fails the call, so the caller's retry covers it. */
  maybe(name: string, url: string): Promise<Raster | null>;
  output(name: string, url: string, picture: Raster, encoding: Encoding): Promise<number>;
};

function sizeOf(r: Raster): Size {
  return { width: r.width, height: r.height };
}

function firstIssuePath(error: z.ZodError): string {
  const path = error.issues[0]?.path ?? [];
  return path.length ? path.map(String).join(".") : "body";
}

function metaOf(raw: unknown): { job?: unknown; step?: unknown } {
  if (raw && typeof raw === "object") {
    const { job, step } = raw as { job?: unknown; step?: unknown };
    return { job: typeof job === "string" ? job : undefined, step: typeof step === "string" ? step : undefined };
  }
  return {};
}

export function pictureRoutes(deps: PictureRouteDeps): Hono {
  const { fetchImpl, log, now, storageTimeoutMs, clock } = deps;
  const markOf = (parts: unknown) => markOfVersion(deps.searchVersion ?? SEARCH_STEPS_VERSION, parts);
  const { canvasBody, finishBody, locateBody, logoSetBody, postLogosBody, readBody, slotBody, slotFileBody, titleReadBody, transcodeBody } = pictureSchemas(deps.storage);
  const app = new Hono();

  function route<S extends z.ZodType, R extends PictureRoute>(name: R, schema: S, work: (body: z.output<S>, io: Io, pace: Pace) => Promise<PictureResults[R] | NotFinished>): void {
    // Only the routes that search read a budget and a point to carry on from.
    const searches = SEARCHES.has(name);
    app.post(`/${name}`, async (c) => {
      const started = now();
      const began = clock();
      const sizesIn: Record<string, string> = {};
      const sizesOut: Record<string, string> = {};
      let meta: { job?: unknown; step?: unknown } = {};
      const noted: Record<string, unknown> = {};

      const answer = (status: 200 | 400 | 500 | 503, body: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
        const ended = now();
        const ms = ended - started;
        const ok = body.ok === true;
        const line: Record<string, unknown> = { at: new Date(ended).toISOString(), route: name, job: meta.job, step: meta.step, ms, ok };
        if (!ok) line.reason = body.reason;
        Object.assign(line, { in: sizesIn, out: sizesOut }, noted, extra);
        log(line);
        return c.json(ok ? { ...body, ms } : body, status);
      };

      let raw: unknown;
      try {
        raw = JSON.parse(await c.req.text());
      } catch {
        return answer(400, { ok: false, reason: `${NOT_WELL_FORMED}body` });
      }
      meta = metaOf(raw);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return answer(400, { ok: false, reason: NOT_WELL_FORMED + firstIssuePath(parsed.error) });

      // The time the call may work, and how far an earlier call got: read only by the routes that search.
      let budget: number | null = null;
      let sent: SearchSoFar | null = null;
      if (searches) {
        const asked = c.req.header(PICTURE_BUDGET_HEADER);
        if (asked !== undefined) {
          if (!/^[1-9]\d{0,5}$/.test(asked) || Number(asked) > PICTURE_CALL_TIMEOUT_MS) return answer(400, { ok: false, reason: `${NOT_WELL_FORMED}${PICTURE_BUDGET_HEADER}` });
          budget = Number(asked);
          noted.budget = budget;
        }
        const from = c.req.header(PICTURE_FROM_HEADER);
        if (from !== undefined) {
          // A point this service cannot read is not an error: the search starts from the beginning.
          let value: unknown;
          try {
            value = JSON.parse(from);
          } catch {
            value = undefined;
          }
          const read = searchSoFar.safeParse(value);
          sent = read.success ? read.data : null;
          noted.from = "not used";
        }
      }

      const hashes: Record<string, string> = {};
      const inStorage = storageTime(storageTimeoutMs);
      const io: Io = {
        async input(inputName, url) {
          const bytes = await inStorage((limit) => fetchBytes(url, fetchImpl, undefined, limit));
          const picture = await decodeRaster(bytes).catch((err: Error) => {
            throw new Refusal(err.message);
          });
          if (budget !== null || sent) hashes[inputName] = createHash("sha256").update(bytes).digest("hex");
          sizesIn[inputName] = `${picture.width}x${picture.height}`;
          return picture;
        },
        mark: (inputName) => hashes[inputName] ?? "",
        async maybe(inputName, url) {
          try {
            return await io.input(inputName, url);
          } catch (err) {
            if (err instanceof Refusal || (err instanceof StorageError && !err.transient)) return null;
            throw err;
          }
        },
        async output(outputName, url, picture, encoding) {
          const bytes = encoding.type === "png" ? await encodePng(picture) : await encodeJpeg(picture, encoding.quality);
          await inStorage((limit) => putBytes(url, bytes, encoding.type === "png" ? "image/png" : "image/jpeg", fetchImpl, limit));
          sizesOut[outputName] = `${picture.width}x${picture.height}, ${bytes.byteLength} B`;
          return bytes.byteLength;
        },
      };

      const over = () => budget !== null && clock() - began >= budget;
      const pace: Pace = {
        budgeted: budget !== null,
        over,
        carries: (of) => sent !== null && sent.of === of,
        async search(of, steps) {
          const from = sent && sent.of === of ? { done: sent.done, at: sent.at } : undefined;
          if (from) noted.from = "used";
          const work = steps(from);
          let turned = clock();
          for (;;) {
            const step = work.next();
            if (step.done) return { value: step.value };
            if (over() && further(step.value, from)) return { soFar: { of, ...step.value } };
            if (clock() - turned >= TURN_MS) {
              await new Promise<void>((resolve) => setImmediate(resolve));
              turned = clock();
            }
          }
        },
      };

      try {
        const result = await work(parsed.data, io, pace);
        if (result instanceof NotFinished) return answer(200, { ok: true, unfinished: result.unfinished }, { unfinished: true });
        return answer(200, { ok: true, result });
      } catch (err) {
        if (err instanceof StorageError) return answer(err.transient ? 503 : 200, { ok: false, reason: err.message });
        if (err instanceof Refusal || err instanceof UnusableLogo) return answer(200, { ok: false, reason: err.message });
        return answer(500, { ok: false, reason: NOT_FINISHED }, { error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  route("canvas", canvasBody, async (body, io) => {
    const logo = await io.input("logo", body.logo);
    const { canvas, mask, rect } = generationCanvas(logo, body.placement, body.page, body.background);
    await io.output("canvas", body.out.canvas, canvas, PNG);
    await io.output("mask", body.out.mask, mask, PNG);
    return { rect, canvas: sizeOf(canvas), mask: sizeOf(mask) };
  });

  /** The parts of a placement and the sizes searched that a search's mark carries. */
  const whereOf = (body: { placement: { anchor: string; width: number; top: number; left?: number }; scales: [number, number] }) => [body.placement.anchor, body.placement.width, body.placement.top, body.placement.left ?? null, body.scales];

  route("locate", locateBody, async (body, io, pace) => {
    const design = await io.input("design", body.design);
    const where = whereOf(body);
    // A job with one file: answered exactly as before.
    if (body.logo !== undefined && body.background !== undefined) {
      const logo = await io.input("logo", body.logo);
      const { background } = body;
      const of = markOf(["locate", io.mark("design"), io.mark("logo"), background, where]);
      const ran = await pace.search(of, (from) => locateLogoSteps(design, logo, body.placement, background, body.scales, from));
      return "value" in ran ? ran.value : new NotFinished({ search: ran.soFar });
    }
    // A job that carries a logo set: one or two templates, and the files to compare by color.
    const templates: TemplateIn[] = [];
    for (const [i, t] of (body.templates ?? []).entries()) templates.push({ file: t.file, raster: await io.input(`template${i}`, t.logo), ground: t.ground, fixed: t.fixed, names: t.names });
    const compare: CompareIn[] = [];
    for (const c of body.compare ?? []) compare.push({ file: c.file, raster: await io.input(`compare.${c.file}`, c.logo) });
    const of = markOf(["locate", io.mark("design"), templates.map((t, i) => [t.file, io.mark(`template${i}`), t.ground, !!t.fixed]), where]);
    const ran = await pace.search(of, (from) => locateTemplatesSteps(design, templates, compare, body.placement, body.scales, from));
    return "value" in ran ? ran.value : new NotFinished({ search: ran.soFar });
  });

  route("read", readBody, async (body, io) => {
    const picture = await io.input("picture", body.picture);
    const read = readPictures(picture, body.page, { band: body.band, area: body.area });
    const result: PictureResults["read"] = { picture: sizeOf(picture), page: sizeOf(read.page) };
    await io.output("page", body.out.page, read.page, READ_JPEG);
    if (read.band && body.out.band) {
      await io.output("band", body.out.band, read.band, READ_JPEG);
      result.band = sizeOf(read.band);
    }
    if (read.area && body.out.area) {
      await io.output("area", body.out.area, read.area, PNG);
      result.area = sizeOf(read.area);
    }
    return result;
  });

  route("finish", finishBody, async (body, io) => {
    const picture = await io.input("picture", body.picture);
    const logo = await io.input("logo", body.logo);
    const pictureSize = sizeOf(picture);
    const finished = finishPicture(picture, logo, body.rect, body.frame, body.output);
    const bytes = await io.output("out", body.out, finished, PNG);
    return { picture: pictureSize, output: sizeOf(finished), bytes };
  });

  route("transcode", transcodeBody, async (body, io) => {
    const picture = await io.input("picture", body.picture);
    const bytes = await io.output("out", body.out, picture, { type: "jpeg", quality: body.quality });
    return { size: sizeOf(picture), bytes };
  });

  route("title-read", titleReadBody, async (body, io) => {
    const layer = await io.input("layer", body.layer);
    const { box, read } = titleRead(layer);
    if (read) await io.output("out", body.out, read, READ_JPEG);
    return { layer: sizeOf(layer), box, read: read ? sizeOf(read) : null };
  });

  route("logo-set", logoSetBody, async (body, io) => {
    const logo = await io.input("logo", body.logo);
    const site: Array<Raster | null> = [];
    for (const [i, link] of (body.site ?? []).entries()) site.push(await io.maybe(`site${i}`, link));
    // A person's second file that cannot be read is left out like a website file: the set is made without it.
    const person = body.person ? await io.maybe("person", body.person) : null;
    const made = logoSet(logo, site, person);
    // A copy the rule dropped is the stored file again: nothing is written for it.
    if (made.other) await io.output("other", body.out.other, made.other, PNG);
    if (made.white) await io.output("white", body.out.white, made.white, PNG);
    return made.result;
  });

  route("post-logos", postLogosBody, async (body, io, pace) => {
    // The files searched for and compared with are read first, before any search starts.
    const searches: TemplateIn[] = [];
    for (const [i, t] of body.searches.entries()) searches.push({ file: t.file, raster: await io.input(`search${i}`, t.logo), ground: t.ground, fixed: t.fixed });
    const compare: CompareIn[] = [];
    for (const c of body.compare) compare.push({ file: c.file, raster: await io.input(`compare.${c.file}`, c.logo) });
    const files = searches.map((t, i) => [t.file, io.mark(`search${i}`), t.ground, !!t.fixed]);
    const where = whereOf(body);
    // One post at a time, so only one is decoded at once. A post that cannot be read is null in its place.
    // A call that sent a budget answers the posts it finished when its time is used; the first post is always worked on.
    const posts: PictureResults["post-logos"]["posts"] = [];
    for (const [i, link] of body.posts.entries()) {
      if (i > 0 && pace.over()) return new NotFinished({ posts });
      let post: Raster | null;
      try {
        post = await io.maybe(`post${i}`, link);
      } catch (err) {
        // Storage that cannot serve a later post right now does not lose the posts already finished: the caller asks for the rest again.
        if (pace.budgeted && posts.length && err instanceof StorageError && err.transient) return new NotFinished({ posts });
        throw err;
      }
      if (!post) {
        posts.push(null);
        continue;
      }
      const picture = post;
      const of = markOf(["post-logos", io.mark(`post${i}`), files, where]);
      const ran = await pace.search(of, (from) => postLogoSteps(picture, searches, compare, body.placement, body.scales, from));
      if (!("value" in ran)) return new NotFinished({ posts, search: ran.soFar });
      posts.push(ran.value);
    }
    return { posts };
  });

  // Where the logo goes on a design: the found drawing, or the rectangle the canvas carried.
  // Its search (each template, in either tone) is the service's longest work, so it runs through the pace like every other.
  route("slot", slotBody, async (body, io, pace) => {
    const design = await io.input("design", body.design);
    const templates: TemplateIn[] = [];
    for (const [i, t] of body.templates.entries()) templates.push({ file: t.file, raster: await io.input(`template${i}`, t.logo), ground: t.ground });
    const of = markOf(["slot", io.mark("design"), templates.map((t, i) => [t.file, io.mark(`template${i}`), t.ground]), whereOf(body)]);
    const ran = await pace.search(of, (from) => findSlotSteps(design, templates, body.placement, body.scales, from));
    return "value" in ran ? ran.value : new NotFinished({ search: ran.soFar });
  });

  // The cleaned slot: the ground under it, the file that shows there, and whether the drawing is gone.
  // The look for the drawing at the slot is a search too, and runs through the same pace.
  route("slot-file", slotFileBody, async (body, io, pace) => {
    const cleaned = await io.input("picture", body.picture);
    // With the first picture: the slot is read on the composed picture (compose.ts). No picture composed: the cleaned one, as before.
    // Composing is no search: it is made again, from the same pixels, by every call of a search that takes several, and it is stored once,
    // by the call that ends the search (below).
    let picture = cleaned;
    let composed: FirstPictureFacts | undefined;
    if (body.first && body.out) {
      const made = composeForSlot(await io.maybe("first", body.first), cleaned, body.rect, body.frame, !!body.drawn);
      composed = made.facts;
      picture = made.picture;
    }
    const files: StampIn[] = [];
    for (const f of body.files) files.push({ file: f.file, raster: await io.input(`file.${f.file}`, f.logo), last: f.last });
    // The slot read on one picture. Its mark names the picture searched: the cleaned one, or the one composed from it and the first picture.
    const drawn = body.drawn ? [body.drawn.file, io.mark(`file.${body.drawn.file}`), body.drawn.ground] : null;
    const markFor = (first: string | null) => markOf(["slot-file", io.mark("picture"), first, drawn, body.rect, body.frame]);
    const readOn = (on: Raster, of: string) => pace.search(of, (from) => slotFileSteps(on, body.rect, body.frame, body.of, files, body.drawn, from));
    const onCleaned = markFor(null);
    if (composed?.made && body.out) {
      // A point of the cleaned picture's search, sent with a request for a composed one, is from a call that ended the composed
      // picture's search, could not store the picture and went on to the cleaned one: this call carries on there, and tries nothing again.
      if (pace.carries(onCleaned)) composed = { made: false, why: "store", share: composed.share, join: composed.join };
      else {
        const ran = await readOn(picture, markFor(io.mark("first")));
        if (!("value" in ran)) return new NotFinished({ search: ran.soFar });
        // The search has ended, so this is the call that answers: only now is the composed picture stored, once however many calls the search took.
        try {
          await io.output("out", body.out, picture, PNG);
          return { ...ran.value, composed };
        } catch (err) {
          // A composed picture that cannot be stored is no composed picture: the cleaned one is read and stays the design's base.
          if (!(err instanceof StorageError)) throw err;
          composed = { made: false, why: "store", share: composed.share, join: composed.join };
        }
      }
    }
    const ran = await readOn(cleaned, onCleaned);
    if (!("value" in ran)) return new NotFinished({ search: ran.soFar });
    return { ...ran.value, ...(composed ? { composed } : {}) };
  });

  return app;
}
