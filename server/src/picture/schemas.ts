// server/src/picture/schemas.ts
//
// The request body of each picture route (12 Nov 2026), checked before any
// storage call: strict objects (an unknown field is refused), every link an
// https link in the storage the service was given (the product's own; a link
// anywhere else is refused here, before anything is fetched), sizes and
// rectangle sides non-negative integers, rectangle corners integers that may
// be negative (a logo can sit past the page edge), JPEG quality 1 to 100. A
// read that asks for a band or an area must also say where to put it. The
// shapes follow the contract's request types.

import { z } from "zod";
import { inStorage } from "../storage.ts";

const meta = { job: z.string(), step: z.string() };
const side = z.int().min(0);
const size = z.strictObject({ width: side, height: side });
const rect = z.strictObject({ x: z.int(), y: z.int(), width: side, height: side });
const channel = z.int().min(0).max(255);
const rgb = z.tuple([channel, channel, channel]);
const placement = z.strictObject({ anchor: z.enum(["left", "center", "right"]), width: z.number(), top: z.number(), left: z.number().optional() });
const frame = z.tuple([z.int().min(1), z.int().min(1)]);

/** The six bodies, for a service that reads and writes under `storage`. */
export function pictureSchemas(storage: string) {
  const stored = z.string().refine((link) => inStorage(link, storage), "The link is not in the product's storage.");

  const canvasBody = z.strictObject({ ...meta, logo: stored, page: size, placement, background: rgb, out: z.strictObject({ canvas: stored, mask: stored }) });

  const locateBody = z.strictObject({ ...meta, design: stored, logo: stored, placement, background: rgb, scales: z.tuple([z.number(), z.number()]) });

  const readBody = z
    .strictObject({ ...meta, picture: stored, page: size, band: rect.optional(), area: rect.optional(), out: z.strictObject({ page: stored, band: stored.optional(), area: stored.optional() }) })
    .superRefine((body, ctx) => {
      if (body.band && !body.out.band) ctx.addIssue({ code: "custom", path: ["out", "band"], message: "A band needs a place to be written." });
      if (body.area && !body.out.area) ctx.addIssue({ code: "custom", path: ["out", "area"], message: "An area needs a place to be written." });
    });

  const finishBody = z.strictObject({ ...meta, picture: stored, logo: stored, rect, frame, output: size, out: stored });

  const transcodeBody = z.strictObject({ ...meta, picture: stored, quality: z.int().min(1).max(100), out: stored });

  const titleReadBody = z.strictObject({ ...meta, layer: stored, out: stored });

  return { canvasBody, locateBody, readBody, finishBody, transcodeBody, titleReadBody };
}
