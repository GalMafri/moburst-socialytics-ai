// supabase/functions/_shared/design/logoSetWork.ts
//
// The two calls an edge function makes to build a client's logo set (16 Nov
// 2026): logo-set, which makes the recolored copies of the stored logo and
// tests the website's other logo files, and post-logos, which reads which
// file each of the client's own posts shows. Both run in the picture
// service and call no model. Used by the lifecycle's design_settings step
// and by the design worker's tone_check action.
//
// The read of posts works to the service's time budget (17 Nov 2026). How
// long a post takes to search depends on the client's logo and pictures, so
// a call answers the posts the service finished within its time, and how far
// it got in the next one; the caller asks for the rest on its next look. The
// number of posts in a call is only the most a request may carry, and does
// not have to be right for any client. A post is asked for with a budget
// PICTURE_MAX_ASKS times at most; after that it is asked for alone, with no
// budget, and the service works it to its end (client.ts).
//
// The service is reached through `PictureIo`, so the step can be run through
// an outage in a test. Logo files are read from generated-media and posts
// from design-references; for both routes the call's `job` is the client's
// id and its `step` is "design_settings".

import { callPicture, callPictureWithin, carriedOf, NotInStorage, signedRead, signedWrite, type Carried, type Worked } from "../picture/client.ts";
import { PICTURE_MAX_ASKS, type LogoSetResult, type PictureRequests, type PictureResults, type Placement, type PostLogo, type SearchSoFar } from "../picture/contract.ts";
import { LOGO_SCALES } from "./logoMatch.ts";
import type { SearchPlan } from "./logoTone.ts";

const LOGOS = "generated-media";
const POSTS = "design-references";
const STEP = "design_settings";

/** The most posts one post-logos request may carry (the service refuses more). How many of them a call reads is set by the service's time budget, not by this number. */
export const POSTS_PER_CALL = 4;

/** The picture service and the signed links, as the set's calls use them. `within` is a call that works to the service's time budget (client.ts, callPictureWithin). `read` throws NotInStorage for a file that is not there (client.ts, signedRead). */
export interface PictureIo {
  call<R extends "logo-set">(route: R, body: PictureRequests[R]): Promise<{ result: PictureResults[R]; ms: number }>;
  within<R extends "post-logos">(route: R, body: PictureRequests[R], carried: Carried | null): Promise<Worked<R>>;
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
    within: (route, body, carried) => callPictureWithin(admin, route, body, carried),
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

/** One read of posts: what the first `posts.length` of the posts asked for gave, how far the service got in the one after them, and the call's time. */
export interface PostsRead {
  /** In the order asked: a post's logo, or null for a post that is gone from storage or cannot be read. Shorter than the list asked for when the service's time was used first. */
  posts: Array<PostLogo | null>;
  /** How far the search of the next post got, when the service stopped in it: given back with the read that starts with that post. */
  next: SearchSoFar | null;
  /** True when the service's time was used before every post asked for was settled. */
  unfinished: boolean;
  ms: number;
}

/**
 * What the client's posts show, searched as the plan says, at the sizes a
 * design is searched at. Up to POSTS_PER_CALL posts are asked for, and the
 * service reads as many as its time budget allows: the answer holds the
 * posts it finished, in the order given, and the caller asks for the rest
 * with its next call. `carried` is what an earlier call left for the first
 * post asked for: how far it got and how many calls were spent on it.
 *
 * A post that is gone from storage is left out: it is null in its place and
 * is not sent (the service does the same for a post whose bytes it cannot
 * read). When no post asked for is in storage no call is made, and `ms`
 * is 0.
 */
export async function askPostLogos(io: PictureIo, a: { clientId: string; posts: string[]; placement: Placement; plan: SearchPlan; carried?: Carried | null }): Promise<PostsRead> {
  const links: Array<string | null> = [];
  for (const path of a.posts) links.push(await readIfThere(io, POSTS, path));
  const sent = links.filter((l): l is string => l !== null);
  if (!sent.length) return { posts: a.posts.map(() => null), next: null, unfinished: false, ms: 0 };
  const searches = [];
  for (const s of a.plan.searches) searches.push({ file: s.file, logo: await io.read(LOGOS, s.path), ground: s.ground, ...(s.fixed ? { fixed: true } : {}) });
  const compare = [];
  for (const c of a.plan.compare) compare.push({ file: c.file, logo: await io.read(LOGOS, c.path) });
  const worked = await io.within("post-logos", {
    job: a.clientId, step: STEP, posts: sent, placement: a.placement, scales: LOGO_SCALES,
    searches: searches as PictureRequests["post-logos"]["searches"], compare,
  }, a.carried ?? null);

  // What the service settled of the posts sent: all of them, or the first few when its time was used.
  let got: Array<PostLogo | null>;
  let next: SearchSoFar | null = null;
  const unfinished = !("result" in worked);
  if ("result" in worked) {
    // One entry per post sent is the contract; an answer of another length says nothing about any of them.
    got = Array.isArray(worked.result.posts) && worked.result.posts.length === sent.length ? worked.result.posts : sent.map(() => null);
  } else {
    const part = worked.unfinished.posts;
    const fits = Array.isArray(part) && part.length < sent.length;
    got = fits ? part : [];
    // How far the service got belongs to the post after the ones it finished; without a count that fits, nothing is kept and the posts are asked for again.
    next = (fits || part === undefined) && worked.unfinished.search ? worked.unfinished.search : null;
  }
  // Back in the places of the posts asked for, up to the first one the service did not settle.
  const posts: Array<PostLogo | null> = [];
  let at = 0;
  for (const link of links) {
    if (link === null) posts.push(null);
    else if (at < got.length) posts.push(got[at++] ?? null);
    else break;
  }
  return { posts, next, unfinished, ms: worked.ms };
}

/**
 * The post whose search the service did not finish within its time: how far
 * it got (`soFar`, sent with the next read, which starts with that post) and
 * how many reads with a budget ended in it (`asks`).
 */
export interface Reading { post: string; soFar?: SearchSoFar; asks: number }

/** A kept Reading read back from a step's result: anything else is none. */
export function readingOf(kept: unknown): Reading | undefined {
  if (!kept || typeof kept !== "object" || typeof (kept as { post?: unknown }).post !== "string") return undefined;
  const carried = carriedOf({ search: (kept as { soFar?: unknown }).soFar, asks: (kept as { asks?: unknown }).asks })!;
  return { post: (kept as { post: string }).post, ...(carried.search ? { soFar: carried.search } : {}), asks: carried.asks };
}

/**
 * One look at the posts of a client that are not read yet: the bookkeeping
 * the lifecycle step and the worker's tone_check share. It asks for the next
 * of them (up to POSTS_PER_CALL), carrying on from `reading` when that is
 * the first post asked for, and answers what each post the service settled
 * gave, in order, and the post it stopped in with how far it got. The caller
 * keeps both and looks again while posts remain, so however long a client's
 * logo takes to search for, the read ends in what one read of every post
 * gives.
 *
 * It also ends, whatever the service answers. Every look either settles a
 * post or counts one more read against the post it stopped in. A post with
 * PICTURE_MAX_ASKS such reads is asked for alone and with no budget
 * (client.ts, callPictureWithin), and that call can only settle it or fail.
 */
export async function readNextPosts(io: PictureIo, a: { clientId: string; unread: string[]; placement: Placement; plan: SearchPlan; reading?: Reading | null }): Promise<{ read: Array<{ post: string; logo: PostLogo | null }>; reading: Reading | null; ms: number }> {
  const reading = a.reading && a.reading.post === a.unread[0] ? a.reading : null;
  // A post that has used every budget is asked for alone: the call with no budget then works on one post only.
  const asked = a.unread.slice(0, reading && reading.asks >= PICTURE_MAX_ASKS ? 1 : POSTS_PER_CALL);
  const got = await askPostLogos(io, { clientId: a.clientId, posts: asked, placement: a.placement, plan: a.plan, carried: reading ? { ...(reading.soFar ? { search: reading.soFar } : {}), asks: reading.asks } : null });
  const settled = got.posts.length;
  const stopped = asked[settled];
  let next: Reading | null = null;
  if (got.unfinished && stopped) {
    // The first post asked for is still the one in progress: one more read counted against it, and the point it had is kept when this read gave none.
    if (settled === 0) {
      const soFar = got.next ?? reading?.soFar;
      next = { post: stopped, ...(soFar ? { soFar } : {}), asks: (reading?.asks ?? 0) + 1 };
    } else if (got.next) next = { post: stopped, soFar: got.next, asks: 1 };
  }
  return { read: got.posts.map((logo, i) => ({ post: asked[i], logo })), reading: next, ms: got.ms };
}
