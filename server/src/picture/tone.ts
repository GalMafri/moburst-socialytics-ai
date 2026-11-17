// server/src/picture/tone.ts
//
// The logo in the tone its picture needs, on decoded pictures (16 Nov 2026).
// Everything that decides is in the shared module the workers and the tests
// read too (supabase/functions/_shared/design/logoTone.ts); this file only
// runs it on the rasters a call was given.

import type { LocateResult, LogoFileName, LogoSetResult, Placement, PostLogo } from "../../../supabase/functions/_shared/picture/contract.ts";
import { makeCopies } from "../../../supabase/functions/_shared/design/logoCopies.ts";
import { logoFound } from "../../../supabase/functions/_shared/design/logoMatch.ts";
import { groundAround, nameFile, partsOf, sameLogo, searchTemplates, stampRect, wholeExposedInks, type CompareIn, type TemplateIn } from "../../../supabase/functions/_shared/design/logoTone.ts";
import type { Raster } from "./raster.ts";

/** A logo the service ran on and could not use, said in the product's words. */
export class UnusableLogo extends Error {}

/** Ties between color distances go to the matched file, then in this order. */
const NAME_ORDER: LogoFileName[] = ["stored", "other", "white"];

/**
 * Locate for a job that carries a logo set. Each template is searched for
 * with the search a single logo gets, and the better match is answered with
 * today's fields, so the worker's one test (logoFound) reads it as before.
 * The answer also names the file closest in color to what was drawn: the
 * file to stamp. Whether the match is good enough stays the worker's
 * decision.
 */
export function locateTemplates(design: Raster, templates: TemplateIn[], compare: CompareIn[], placement: Placement, scales: [number, number]): LocateResult {
  const found = searchTemplates(design, templates, placement, scales);
  const named = nameFile(design, found, templates, compare, [found.matched, ...NAME_ORDER]);
  const rasterOf = (file: LogoFileName) => templates.find((t) => t.file === file)?.raster ?? compare.find((c) => c.file === file)?.raster ?? templates[found.index].raster;
  const stamp = stampRect(found.rect, templates[found.index].raster, rasterOf(named.file));
  return {
    ...found.rect, score: found.score, usual: found.usual, frame: [design.width, design.height],
    file: named.file, matched: found.matched, scores: found.scores, gaps: named.gaps,
    ...(stamp ? { stamp } : {}),
  };
}

/**
 * A client's logo files, from its stored logo: the file's own ground and
 * whether it also shows on the other one, the two recolored copies the
 * making rule gives (null when the rule dropped one), which of the
 * website's logo files is the same logo for the other ground, and the inks
 * of each file a design may start from. `site` holds the website files in
 * the order sent, null for one that could not be read; `person` is a
 * person's second file. Nothing here is trimmed or resized: a copy has the
 * stored file's exact width, height and alpha.
 */
export function logoSet(logo: Raster, site: Array<Raster | null>, person: Raster | null): { result: LogoSetResult; other: Raster | null; white: Raster | null } {
  const parts = partsOf(logo);
  if (!parts.parts.length) throw new UnusableLogo("The logo file has no ink.");
  const copies = makeCopies(logo, parts);

  // The website file that is the same logo for the other ground: the highest overlap, the earlier on the page when equal.
  let passed: { index: number; overlap: number; raster: Raster } | null = null;
  site.forEach((file, index) => {
    if (!file) return;
    const { same, overlap } = sameLogo(logo, parts, file);
    if (same && (!passed || overlap > passed.overlap)) passed = { index, overlap, raster: file };
  });
  const siteFile = passed as { index: number; overlap: number; raster: Raster } | null;

  const second = person ?? siteFile?.raster ?? null;
  return {
    result: {
      size: { width: logo.width, height: logo.height },
      own: copies.own,
      both: copies.both,
      made: { other: copies.other ? { turned: copies.other.turned } : null, white: copies.white ? { turned: copies.white.turned } : null },
      site: siteFile ? { index: siteFile.index, overlap: siteFile.overlap, size: { width: siteFile.raster.width, height: siteFile.raster.height } } : null,
      person: person ? { size: { width: person.width, height: person.height } } : null,
      inks: {
        stored: wholeExposedInks(parts),
        other: second ? wholeExposedInks(partsOf(second)) : copies.other ? wholeExposedInks(parts, copies.other.colors) : null,
        white: copies.white ? wholeExposedInks(parts, copies.white.colors) : null,
      },
    },
    other: copies.other?.raster ?? null,
    white: copies.white?.raster ?? null,
  };
}

/**
 * What one of the client's own posts shows, read the way a design is: the
 * searches near the logo's usual spot, the one test (logoFound), and for a
 * found logo the file closest to it in color and the ground around it. A
 * post with no pixel to sample around its logo says nothing.
 */
export function postLogo(post: Raster, searches: TemplateIn[], compare: CompareIn[], placement: Placement, scales: [number, number]): PostLogo {
  const found = searchTemplates(post, searches, placement, scales);
  if (!logoFound({ width: found.rect.width, score: found.score }, found.usual.width)) return { found: false, score: found.score };
  const around = groundAround(post, found.rect);
  if (!around) return { found: false, score: found.score };
  const named = nameFile(post, found, searches, compare, NAME_ORDER);
  return { found: true, score: found.score, matched: found.matched, rect: found.rect, gaps: named.gaps, shows: named.file, ground: around.ground, flat: around.flat };
}
