// server/src/picture/routes.ts
//
// The six picture routes (12 Nov 2026), mounted at PICTURE_API_BASE behind
// the door (app.ts). Every call has one shape: check the body, read and
// decode its pictures from storage, run the operation, encode and store the
// outputs, answer. A body that is not well formed answers 400 naming its
// first bad field; storage that cannot give or take a picture right now (a
// network error, a 429 or a 5xx) answers 503 with the reason, so the
// worker's retry covers it and the job waits; a picture storage refuses (a
// missing or expired object, a refused upload), or bytes that are not a
// picture, answer 200 with ok false and the reason, so the worker decides
// what that means for its job; anything else answers 500. Each
// answer is preceded by exactly one log line with the sizes in and out and
// never a URL (signed URLs carry tokens) or the call's id. A link that is not
// in the service's storage is a body that is not well formed, and a call's
// reads and writes share one time limit (storage.ts).

import { Hono } from "hono";
import type { z } from "zod";
import { READ_JPEG_QUALITY, type PictureRoute, type PictureResults, type Size } from "../../../supabase/functions/_shared/picture/contract.ts";
import type { Log } from "../log.ts";
import { fetchBytes, putBytes, StorageError, type Fetcher } from "../storage.ts";
import { generationCanvas } from "./canvas.ts";
import { finishPicture } from "./finish.ts";
import { locateLogo } from "./locate.ts";
import { decodeRaster, encodeJpeg, encodePng, type Raster } from "./raster.ts";
import { readPictures } from "./read.ts";
import { pictureSchemas } from "./schemas.ts";
import { titleRead } from "./title.ts";

/** `storage` is the one address the routes read from and write to; `storageTimeoutMs` is how long one call's reads and writes may take together. */
export type PictureRouteDeps = { fetchImpl: Fetcher; log: Log; now: () => number; storage: string; storageTimeoutMs: number };

const NOT_WELL_FORMED = "The request is not well formed: ";
const NOT_FINISHED = "The picture service could not finish this call.";

/** A failure the worker is told about in the product's words: storage, or bytes that are not a picture. */
class Refusal extends Error {}

type Encoding = { type: "png" } | { type: "jpeg"; quality: number };
const PNG: Encoding = { type: "png" };
const READ_JPEG: Encoding = { type: "jpeg", quality: READ_JPEG_QUALITY };

/** Reads inputs and writes outputs for one call, noting each size for the log line. */
type Io = {
  input(name: string, url: string): Promise<Raster>;
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
  const { fetchImpl, log, now, storageTimeoutMs } = deps;
  const { canvasBody, finishBody, locateBody, readBody, titleReadBody, transcodeBody } = pictureSchemas(deps.storage);
  const app = new Hono();

  function route<S extends z.ZodType, R extends PictureRoute>(name: R, schema: S, work: (body: z.output<S>, io: Io) => Promise<PictureResults[R]>): void {
    app.post(`/${name}`, async (c) => {
      const started = now();
      const sizesIn: Record<string, string> = {};
      const sizesOut: Record<string, string> = {};
      let meta: { job?: unknown; step?: unknown } = {};

      const answer = (status: 200 | 400 | 500 | 503, body: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
        const ended = now();
        const ms = ended - started;
        const ok = body.ok === true;
        const line: Record<string, unknown> = { at: new Date(ended).toISOString(), route: name, job: meta.job, step: meta.step, ms, ok };
        if (!ok) line.reason = body.reason;
        Object.assign(line, { in: sizesIn, out: sizesOut }, extra);
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

      const limit = AbortSignal.timeout(storageTimeoutMs);
      const io: Io = {
        async input(inputName, url) {
          const bytes = await fetchBytes(url, fetchImpl, undefined, limit);
          const picture = await decodeRaster(bytes).catch((err: Error) => {
            throw new Refusal(err.message);
          });
          sizesIn[inputName] = `${picture.width}x${picture.height}`;
          return picture;
        },
        async output(outputName, url, picture, encoding) {
          const bytes = encoding.type === "png" ? await encodePng(picture) : await encodeJpeg(picture, encoding.quality);
          await putBytes(url, bytes, encoding.type === "png" ? "image/png" : "image/jpeg", fetchImpl, limit);
          sizesOut[outputName] = `${picture.width}x${picture.height}, ${bytes.byteLength} B`;
          return bytes.byteLength;
        },
      };

      try {
        const result = await work(parsed.data, io);
        return answer(200, { ok: true, result });
      } catch (err) {
        if (err instanceof StorageError) return answer(err.transient ? 503 : 200, { ok: false, reason: err.message });
        if (err instanceof Refusal) return answer(200, { ok: false, reason: err.message });
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

  route("locate", locateBody, async (body, io) => {
    const design = await io.input("design", body.design);
    const logo = await io.input("logo", body.logo);
    return locateLogo(design, logo, body.placement, body.background, body.scales);
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

  return app;
}
