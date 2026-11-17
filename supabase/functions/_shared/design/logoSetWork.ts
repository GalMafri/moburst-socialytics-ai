// supabase/functions/_shared/design/logoSetWork.ts
//
// The two calls an edge function makes to build a client's logo set (16 Nov
// 2026): logo-set, which makes the recolored copies of the stored logo and
// tests the website's other logo files, and post-logos, which reads which
// file each of the client's own posts shows. Both run in the picture
// service and call no model. Used by the lifecycle's design_settings step
// and by the design worker's tone_check action.
//
// The service is reached through `PictureIo`, so the step can be run through
// an outage in a test. Logo files are read from generated-media and posts
// from design-references; for both routes the call's `job` is the client's
// id and its `step` is "design_settings".

import { callPicture, NotInStorage, signedRead, signedWrite } from "../picture/client.ts";
import type { LogoSetResult, PictureRequests, PictureResults, Placement, PostLogo } from "../picture/contract.ts";
import { LOGO_SCALES } from "./logoMatch.ts";
import type { SearchPlan } from "./logoTone.ts";

const LOGOS = "generated-media";
const POSTS = "design-references";
const STEP = "design_settings";

/** The most posts one post-logos call reads (the service refuses more). */
export const POSTS_PER_CALL = 4;

/** The picture service and the signed links, as the set's calls use them. `read` throws NotInStorage for a file that is not there (client.ts, signedRead). */
export interface PictureIo {
  call<R extends "logo-set" | "post-logos">(route: R, body: PictureRequests[R]): Promise<{ result: PictureResults[R]; ms: number }>;
  read(bucket: string, path: string): Promise<string>;
  write(bucket: string, path: string): Promise<string>;
}

/** A read link for a file the call can do without: null when the file is not in storage. Storage that could not answer still throws, so nothing is taken for missing on a bad moment. */
async function readIfThere(io: PictureIo, bucket: string, path: string): Promise<string | null> {
  try {
    return await io.read(bucket, path);
  } catch (e) {
    if (e instanceof NotInStorage) return null;
    throw e;
  }
}

/** The live service, called as the server (the service role client). */
// deno-lint-ignore no-explicit-any
export function liveIo(admin: any): PictureIo {
  return {
    call: (route, body) => callPicture(admin, route, body),
    read: (bucket, path) => signedRead(admin, bucket, path),
    write: (bucket, path) => signedWrite(admin, bucket, path),
  };
}

/**
 * The files of a client's set, from its stored logo: `site` are the stored
 * paths of the website's other logo files (already converted to PNG),
 * `person` a person's second file, `out` where the two copies are written.
 * A person's file that is gone from storage is not sent, and the set is
 * made without it.
 */
export async function askLogoSet(io: PictureIo, a: { clientId: string; logoPath: string; site: string[]; person: string | null; out: { other: string; white: string } }): Promise<{ facts: LogoSetResult; ms: number }> {
  const site: string[] = [];
  for (const path of a.site) site.push(await io.read(LOGOS, path));
  const person = a.person ? await readIfThere(io, LOGOS, a.person) : null;
  const { result, ms } = await io.call("logo-set", {
    job: a.clientId, step: STEP,
    logo: await io.read(LOGOS, a.logoPath),
    ...(site.length ? { site } : {}),
    ...(person ? { person } : {}),
    out: { other: await io.write(LOGOS, a.out.other), white: await io.write(LOGOS, a.out.white) },
  });
  return { facts: result, ms };
}

/**
 * What up to four of the client's posts show, searched as the plan says, at
 * the sizes a design is searched at. One entry per post, in the order given.
 * A post that is gone from storage is left out: it is null in its place and
 * is not sent (the service does the same for a post whose bytes it cannot
 * read). When no post of the batch is in storage no call is made, and `ms`
 * is 0.
 */
export async function askPostLogos(io: PictureIo, a: { clientId: string; posts: string[]; placement: Placement; plan: SearchPlan }): Promise<{ posts: Array<PostLogo | null>; ms: number }> {
  const links: Array<string | null> = [];
  for (const path of a.posts) links.push(await readIfThere(io, POSTS, path));
  const sent = links.filter((l): l is string => l !== null);
  if (!sent.length) return { posts: a.posts.map(() => null), ms: 0 };
  const searches = [];
  for (const s of a.plan.searches) searches.push({ file: s.file, logo: await io.read(LOGOS, s.path), ground: s.ground, ...(s.fixed ? { fixed: true } : {}) });
  const compare = [];
  for (const c of a.plan.compare) compare.push({ file: c.file, logo: await io.read(LOGOS, c.path) });
  const { result, ms } = await io.call("post-logos", {
    job: a.clientId, step: STEP, posts: sent, placement: a.placement, scales: LOGO_SCALES,
    searches: searches as PictureRequests["post-logos"]["searches"], compare,
  });
  // One entry per post sent is the contract; an answer of another length says nothing about any of them.
  const got = Array.isArray(result.posts) && result.posts.length === sent.length ? result.posts : sent.map(() => null);
  let next = 0;
  return { posts: links.map((l) => (l === null ? null : got[next++] ?? null)), ms };
}
