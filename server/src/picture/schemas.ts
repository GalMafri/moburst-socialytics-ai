// server/src/picture/schemas.ts
//
// The request body of each picture route (12 Nov 2026), checked before any
// storage call: strict objects (an unknown field is refused), every link an
// https link in the storage the service was given (the product's own; a link
// anywhere else is refused here, before anything is fetched), sizes and
// rectangle sides non-negative integers, rectangle corners integers that may
// be negative (a logo can sit past the page edge), JPEG quality 1 to 100. A
// read that asks for a band or an area must also say where to put it. A
// locate body is one of two shapes, never a mix: one logo over one
// background, or one or two templates and a list of files to compare. A
// template may list the other files that may be named when it is the match
// (17 Nov 2026). The shapes follow the contract's request types.

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

const fileName = z.enum(["stored", "other", "white"]);

type Named = { file: string; ground?: readonly number[] };
/**
 * The file rules of a request that carries a logo set: two templates may
 * name one file only when their grounds differ (a file that serves both
 * grounds), and a file to compare is in no template and listed once.
 */
function fileRules(templates: Named[], compare: Named[], key: string, ctx: z.RefinementCtx): void {
  const [first, second] = templates;
  if (second && second.file === first.file && String(second.ground) === String(first.ground)) {
    ctx.addIssue({ code: "custom", path: [key, 1, "file"], message: "Two templates of one file need two grounds." });
  }
  compare.forEach((c, i) => {
    if (templates.some((t) => t.file === c.file) || compare.findIndex((o) => o.file === c.file) !== i) {
      ctx.addIssue({ code: "custom", path: ["compare", i, "file"], message: "A file to compare is in no template and is listed once." });
    }
  });
}

/** The eight bodies, for a service that reads and writes under `storage`. */
export function pictureSchemas(storage: string) {
  const stored = z.string().refine((link) => inStorage(link, storage), "The link is not in the product's storage.");
  const template = z.strictObject({ file: fileName, logo: stored, ground: rgb, fixed: z.boolean().optional(), names: z.array(fileName).max(3).optional() });
  const templates = z.array(template).min(1).max(2);
  const compare = z.array(z.strictObject({ file: fileName, logo: stored })).max(3);

  const canvasBody = z.strictObject({ ...meta, logo: stored, page: size, placement, background: rgb, out: z.strictObject({ canvas: stored, mask: stored }) });

  const locateBody = z
    .strictObject({ ...meta, design: stored, placement, scales: z.tuple([z.number(), z.number()]), logo: stored.optional(), background: rgb.optional(), templates: templates.optional(), compare: compare.optional() })
    .superRefine((body, ctx) => {
      const one = body.logo !== undefined || body.background !== undefined;
      const set = body.templates !== undefined || body.compare !== undefined;
      if (one && set) {
        ctx.addIssue({ code: "custom", path: ["templates"], message: "A locate request has a logo and a background, or templates and files to compare, never both." });
      } else if (one) {
        if (body.logo === undefined) ctx.addIssue({ code: "custom", path: ["logo"], message: "A background needs a logo." });
        if (body.background === undefined) ctx.addIssue({ code: "custom", path: ["background"], message: "A logo needs a background." });
      } else if (set) {
        if (body.templates === undefined) ctx.addIssue({ code: "custom", path: ["templates"], message: "Files to compare need a template." });
        else if (body.compare === undefined) ctx.addIssue({ code: "custom", path: ["compare"], message: "Templates need the list of files to compare, which may be empty." });
        else fileRules(body.templates, body.compare, "templates", ctx);
      } else {
        ctx.addIssue({ code: "custom", path: ["logo"], message: "A locate request needs a logo or templates." });
      }
    });

  const readBody = z
    .strictObject({ ...meta, picture: stored, page: size, band: rect.optional(), area: rect.optional(), out: z.strictObject({ page: stored, band: stored.optional(), area: stored.optional() }) })
    .superRefine((body, ctx) => {
      if (body.band && !body.out.band) ctx.addIssue({ code: "custom", path: ["out", "band"], message: "A band needs a place to be written." });
      if (body.area && !body.out.area) ctx.addIssue({ code: "custom", path: ["out", "area"], message: "An area needs a place to be written." });
    });

  const finishBody = z.strictObject({ ...meta, picture: stored, logo: stored, rect, frame, output: size, out: stored });

  const transcodeBody = z.strictObject({ ...meta, picture: stored, quality: z.int().min(1).max(100), out: stored });

  const titleReadBody = z.strictObject({ ...meta, layer: stored, out: stored });

  const logoSetBody = z.strictObject({ ...meta, logo: stored, site: z.array(stored).max(6).optional(), person: stored.optional(), out: z.strictObject({ other: stored, white: stored }) });

  const postLogosBody = z
    .strictObject({ ...meta, posts: z.array(stored).min(1).max(4), placement, scales: z.tuple([z.number(), z.number()]), searches: templates, compare })
    .superRefine((body, ctx) => fileRules(body.searches, body.compare, "searches", ctx));

  return { canvasBody, locateBody, readBody, finishBody, transcodeBody, titleReadBody, logoSetBody, postLogosBody };
}
