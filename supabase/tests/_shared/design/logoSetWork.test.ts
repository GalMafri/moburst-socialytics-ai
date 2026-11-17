// @vitest-environment node
// The two picture calls an edge function makes to build a client's logo
// set, with their signed links.
import { describe, expect, it } from "vitest";
import { askLogoSet, askPostLogos, POSTS_PER_CALL, readingOf, readNextPosts, type PictureIo, type Reading } from "../../../functions/_shared/design/logoSetWork";
import { NotInStorage, type Carried } from "../../../functions/_shared/picture/client";
import { PICTURE_MAX_ASKS, type LogoSetResult, type PostLogo, type PostLogosResult, type SearchSoFar, type Unfinished } from "../../../functions/_shared/picture/contract";

const FACTS: LogoSetResult = { size: { width: 300, height: 90 }, own: "light", both: false, made: { other: { turned: 1 }, white: null }, site: null, person: null, inks: { stored: [], other: [], white: null } };

/** A picture service that records what it was asked, with links that say what was signed. A read of posts answers `posts` in full, or `unfinished` when that is given. */
function fakeIo(answer: { set?: LogoSetResult; posts?: PostLogosResult; unfinished?: Unfinished; gone?: string[]; down?: string[] } = {}) {
  const calls: Array<{ route: string; body: Record<string, unknown>; carried?: Carried | null }> = [];
  const io: PictureIo = {
    async call(route, body) {
      calls.push({ route, body: body as unknown as Record<string, unknown> });
      return { result: (answer.set ?? FACTS) as never, ms: 321 };
    },
    async within(route, body, carried) {
      calls.push({ route, body: body as unknown as Record<string, unknown>, carried });
      if (answer.unfinished) return { unfinished: answer.unfinished, carried: { ...(answer.unfinished.search ? { search: answer.unfinished.search } : {}), asks: (carried?.asks ?? 0) + 1 }, ms: 20_004 };
      return { result: (answer.posts ?? { posts: [] }) as never, ms: 321 };
    },
    read: async (bucket, path) => {
      // What signedRead does for a file that is gone, and for storage that could not answer.
      if (answer.gone?.includes(path)) throw new NotInStorage(`Could not prepare ${path} for the picture service: Object not found`);
      if (answer.down?.includes(path)) throw new Error(`Could not prepare ${path} for the picture service: fetch failed`);
      return `read:${bucket}/${path}`;
    },
    write: async (bucket, path) => `write:${bucket}/${path}`,
  };
  return { io, calls };
}

describe("the logo set's calls", () => {
  it("signs the logo, the website files and a person's file for reading and the two copies for writing", async () => {
    const { io, calls } = fakeIo();
    const got = await askLogoSet(io, {
      clientId: "c1", logoPath: "c1/design-settings/logo-site-aaaa.png",
      site: ["c1/design-settings/logo-site-bbbb.png", "c1/design-settings/logo-site-cccc.png"], person: "c1/design-settings/logo-other-9.png",
      out: { other: "c1/design-settings/logo-0123456789abcdef-other.png", white: "c1/design-settings/logo-0123456789abcdef-white.png" },
    });
    expect(got).toEqual({ facts: FACTS, ms: 321 });
    expect(calls).toEqual([{
      route: "logo-set",
      body: {
        job: "c1", step: "design_settings",
        logo: "read:generated-media/c1/design-settings/logo-site-aaaa.png",
        site: ["read:generated-media/c1/design-settings/logo-site-bbbb.png", "read:generated-media/c1/design-settings/logo-site-cccc.png"],
        person: "read:generated-media/c1/design-settings/logo-other-9.png",
        out: { other: "write:generated-media/c1/design-settings/logo-0123456789abcdef-other.png", white: "write:generated-media/c1/design-settings/logo-0123456789abcdef-white.png" },
      },
    }]);

    // With no website file and no person's file, neither field is sent.
    const bare = fakeIo();
    await askLogoSet(bare.io, { clientId: "c1", logoPath: "c1/logo.png", site: [], person: null, out: { other: "c1/o.png", white: "c1/w.png" } });
    expect(Object.keys(bare.calls[0].body).sort()).toEqual(["job", "logo", "out", "step"]);
  });

  it("sends the stored file's search first and marks a person's file", async () => {
    const posts = { posts: [{ found: false as const, score: 0.3 }, null] };
    const { io, calls } = fakeIo({ posts });
    const placement = { anchor: "center" as const, width: 0.14, top: 0.928 };
    const got = await askPostLogos(io, {
      clientId: "c1", posts: ["c1/social-a.jpg", "c1/social-b.jpg"], placement,
      plan: {
        searches: [{ file: "stored", path: "c1/logo.png", ground: [255, 255, 255] }, { file: "other", path: "c1/design-settings/logo-other-9.png", ground: [11, 14, 26], fixed: true }],
        compare: [{ file: "white", path: "c1/design-settings/logo-0123456789abcdef-white.png" }],
      },
    });
    expect(got).toEqual({ posts: posts.posts, next: null, unfinished: false, ms: 321 });
    expect(calls).toEqual([{
      route: "post-logos",
      carried: null,
      body: {
        job: "c1", step: "design_settings",
        posts: ["read:design-references/c1/social-a.jpg", "read:design-references/c1/social-b.jpg"],
        placement, scales: [0.45, 1.35],
        searches: [
          { file: "stored", logo: "read:generated-media/c1/logo.png", ground: [255, 255, 255] },
          { file: "other", logo: "read:generated-media/c1/design-settings/logo-other-9.png", ground: [11, 14, 26], fixed: true },
        ],
        compare: [{ file: "white", logo: "read:generated-media/c1/design-settings/logo-0123456789abcdef-white.png" }],
      },
    }]);
  });

  const SEARCH = { searches: [{ file: "stored" as const, path: "c1/logo.png", ground: [255, 255, 255] as [number, number, number] }], compare: [] };
  const AT = { anchor: "center" as const, width: 0.2, top: 0.04 };

  it("leaves out a post that is gone from storage, sends the rest, and puts each answer back in its place", async () => {
    const hit = { found: false as const, score: 0.4 };
    const { io, calls } = fakeIo({ posts: { posts: [hit, null] }, gone: ["c1/gone.jpg"] });
    const got = await askPostLogos(io, { clientId: "c1", posts: ["c1/a.jpg", "c1/gone.jpg", "c1/b.jpg"], placement: AT, plan: SEARCH });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.posts).toEqual(["read:design-references/c1/a.jpg", "read:design-references/c1/b.jpg"]);
    expect(got.posts).toEqual([hit, null, null]);
  });

  it("makes no call when no post of the batch is in storage", async () => {
    const { io, calls } = fakeIo({ gone: ["c1/gone-1.jpg", "c1/gone-2.jpg"] });
    const got = await askPostLogos(io, { clientId: "c1", posts: ["c1/gone-1.jpg", "c1/gone-2.jpg"], placement: AT, plan: SEARCH });
    expect(calls).toEqual([]);
    expect(got).toEqual({ posts: [null, null], next: null, unfinished: false, ms: 0 });
  });

  it("does not take storage that could not answer for a missing post", async () => {
    const { io, calls } = fakeIo({ down: ["c1/b.jpg"] });
    await expect(askPostLogos(io, { clientId: "c1", posts: ["c1/a.jpg", "c1/b.jpg"], placement: AT, plan: SEARCH })).rejects.toThrow("fetch failed");
    expect(calls).toEqual([]);
  });

  it("leaves out a person's second file that is gone from storage", async () => {
    const { io, calls } = fakeIo({ gone: ["c1/design-settings/logo-other-9.png"] });
    await askLogoSet(io, { clientId: "c1", logoPath: "c1/logo.png", site: [], person: "c1/design-settings/logo-other-9.png", out: { other: "c1/o.png", white: "c1/w.png" } });
    expect(Object.keys(calls[0].body).sort()).toEqual(["job", "logo", "out", "step"]);
  });

  const SO_FAR: SearchSoFar = { of: "0123456789abcdef0123456789abcdef", done: [{ x: 10, y: 12, width: 40, height: 16, score: 0.41 }], at: { size: 7, row: 12, best: { x: 4, y: 2, width: 22, height: 9, score: 0.38 } } };

  it("keeps the posts the service finished within its time, and how far it got in the next one", async () => {
    const hit = { found: false as const, score: 0.4 };
    const { io } = fakeIo({ unfinished: { posts: [hit, null], search: SO_FAR } });
    const got = await askPostLogos(io, { clientId: "c1", posts: ["c1/a.jpg", "c1/b.jpg", "c1/c.jpg", "c1/d.jpg"], placement: AT, plan: SEARCH });
    // Two of four are settled; the third was begun, the fourth not reached. Neither is taken for unreadable.
    expect(got).toEqual({ posts: [hit, null], next: SO_FAR, unfinished: true, ms: 20_004 });
  });

  it("sends how far an earlier call got, exactly as the service gave it, with the calls already spent on that post", async () => {
    const { io, calls } = fakeIo({ posts: { posts: [{ found: false, score: 0.2 }] } });
    await askPostLogos(io, { clientId: "c1", posts: ["c1/c.jpg"], placement: AT, plan: SEARCH, carried: { search: SO_FAR, asks: 2 } });
    expect(calls[0].carried).toEqual({ search: SO_FAR, asks: 2 });
  });

  it("puts a partial answer back around the posts that are gone, up to the first one the service did not settle", async () => {
    const hit = { found: false as const, score: 0.4 };
    // b is gone: a, c and d are sent. The service finished a and stopped in c.
    const { io, calls } = fakeIo({ unfinished: { posts: [hit], search: SO_FAR }, gone: ["c1/b.jpg"] });
    const got = await askPostLogos(io, { clientId: "c1", posts: ["c1/a.jpg", "c1/b.jpg", "c1/c.jpg", "c1/d.jpg"], placement: AT, plan: SEARCH });
    expect(calls[0].body.posts).toEqual(["read:design-references/c1/a.jpg", "read:design-references/c1/c.jpg", "read:design-references/c1/d.jpg"]);
    // a as answered, b gone; the point belongs to c, the post after them.
    expect(got).toEqual({ posts: [hit, null], next: SO_FAR, unfinished: true, ms: 20_004 });
  });

  it("keeps nothing of an unfinished answer whose count cannot be right, so the posts are asked for again", async () => {
    const { io } = fakeIo({ unfinished: { posts: [null, null, null], search: SO_FAR } });
    const got = await askPostLogos(io, { clientId: "c1", posts: ["c1/a.jpg", "c1/b.jpg"], placement: AT, plan: SEARCH });
    expect(got).toEqual({ posts: [], next: null, unfinished: true, ms: 20_004 });
  });

  it("answers null for every post when the service gave back another count", async () => {
    const { io } = fakeIo({ posts: { posts: [null] } });
    const got = await askPostLogos(io, { clientId: "c1", posts: ["a.jpg", "b.jpg"], placement: { anchor: "center", width: 0.2, top: 0.04 }, plan: { searches: [{ file: "stored", path: "c1/logo.png", ground: [255, 255, 255] }], compare: [] } });
    expect(got.posts).toEqual([null, null]);
  });
});

describe("the read of a client's posts, one look at a time", () => {
  const PLAN = { searches: [{ file: "stored" as const, path: "c1/logo.png", ground: [255, 255, 255] as [number, number, number] }], compare: [] };
  const PLACE = { anchor: "center" as const, width: 0.2, top: 0.04 };
  const shows = (path: string): PostLogo => ({ found: false, score: Number(`0.${path.replace(/\D/g, "")}`) });

  /**
   * A service that gets through `perCall` units of work in a call's time,
   * where a post costs `cost` units. What it did of a post it did not
   * finish comes back as the point to carry on from; a call that brings that
   * point for its first post starts there. `work` counts the units spent on
   * each post, so a post searched from the beginning twice shows.
   */
  function service(perCall: number, cost: number, gone: string[] = []) {
    const work: Record<string, number> = {};
    const calls: Array<{ posts: string[]; from: string | null; asks: number }> = [];
    const io: PictureIo = {
      call: async () => { throw new Error("not used here"); },
      async within(_route, body, carried) {
        const from = carried?.search;
        const asks = (carried?.asks ?? 0) + 1;
        const links = (body as { posts: string[] }).posts;
        calls.push({ posts: links, from: from?.of ?? null, asks: carried?.asks ?? 0 });
        let units = perCall;
        const done: Array<PostLogo | null> = [];
        for (const [i, link] of links.entries()) {
          const had = i === 0 && from?.of === link ? from.at!.size : 0;
          const spend = Math.min(units, cost - had);
          work[link] = (work[link] ?? 0) + spend;
          units -= spend;
          if (had + spend < cost) {
            const search = { of: link, done: [], at: { size: had + spend, row: 0, best: { x: 0, y: 0, width: 0, height: 0, score: -2 } } };
            return { unfinished: { posts: done, search }, carried: { search, asks }, ms: 20_003 };
          }
          done.push(shows(link));
          if (units === 0 && i < links.length - 1) return { unfinished: { posts: done }, carried: { asks }, ms: 20_001 };
        }
        return { result: { posts: done } as never, ms: 9_000 };
      },
      read: async (_bucket, path) => {
        if (gone.includes(path)) throw new NotInStorage(`Could not prepare ${path} for the picture service: Object not found`);
        return path;
      },
      write: async (_bucket, path) => path,
    };
    return { io, work, calls };
  }

  /** Looks until every post is read, the way the lifecycle step and tone_check do, keeping what each look gave. */
  async function readAll(io: PictureIo, posts: string[]) {
    const shown: Record<string, PostLogo | null> = {};
    let reading: Reading | null = null;
    let looks = 0;
    for (;;) {
      const unread = posts.filter((p) => !(p in shown));
      if (!unread.length) return { shown, looks };
      if (++looks > 200) throw new Error("the read did not end");
      const looked = await readNextPosts(io, { clientId: "c1", unread, placement: PLACE, plan: PLAN, reading });
      for (const { post, logo } of looked.read) shown[post] = logo;
      reading = looked.reading;
    }
  }

  const nine = Array.from({ length: 9 }, (_, i) => `c1/post-${i + 1}.jpg`);
  const whole = Object.fromEntries(nine.map((p) => [p, shows(p)]));

  it("ends in what one read of every post gives, whatever the service gets through in a call", async () => {
    // From a service that reads every post asked for at once to one that needs seven calls for a single post.
    for (const [perCall, cost] of [[100, 1], [4, 1], [3, 2], [1, 1], [2, 5], [1, 7]] as const) {
      const s = service(perCall, cost);
      const got = await readAll(s.io, nine);
      expect(got.shown, `${perCall} of ${cost}`).toEqual(whole);
      // Every post cost its own work once: nothing was searched from the beginning twice.
      expect(s.work, `${perCall} of ${cost}`).toEqual(Object.fromEntries(nine.map((p) => [p, cost])));
      // A request never carries more than the service takes, and the looks it took are what the work needs, no more.
      expect(s.calls.every((c) => c.posts.length >= 1 && c.posts.length <= POSTS_PER_CALL)).toBe(true);
      expect(got.looks, `${perCall} of ${cost}`).toBeLessThanOrEqual(Math.max(Math.ceil(nine.length / POSTS_PER_CALL), Math.ceil((nine.length * cost) / perCall)) + 1);
    }
  });

  it("starts each look with the first post not yet read, and carries a point only into the post it belongs to", async () => {
    const s = service(3, 2);
    await readAll(s.io, nine);
    expect(s.calls.map((c) => c.posts[0])).toEqual(["c1/post-1.jpg", "c1/post-2.jpg", "c1/post-4.jpg", "c1/post-5.jpg", "c1/post-7.jpg", "c1/post-8.jpg"]);
    expect(s.calls.map((c) => c.from)).toEqual([null, "c1/post-2.jpg", null, "c1/post-5.jpg", null, "c1/post-8.jpg"]);
    // A point kept for a post that is no longer the first one asked for is not sent.
    const other = service(100, 1);
    await readNextPosts(other.io, { clientId: "c1", unread: nine, placement: PLACE, plan: PLAN, reading: { post: "c1/post-5.jpg", asks: 3, soFar: { of: "c1/post-5.jpg", done: [], at: { size: 1, row: 0, best: { x: 0, y: 0, width: 0, height: 0, score: -2 } } } } });
    expect(other.calls[0].from).toBeNull();
    expect(other.calls[0].asks).toBe(0);
  });

  it("reads around posts that are gone from storage, and ends when the last ones are gone", async () => {
    const gone = ["c1/post-2.jpg", "c1/post-8.jpg", "c1/post-9.jpg"];
    const s = service(3, 2, gone);
    const got = await readAll(s.io, nine);
    expect(got.shown).toEqual({ ...whole, "c1/post-2.jpg": null, "c1/post-8.jpg": null, "c1/post-9.jpg": null });
    expect(Object.keys(s.work).sort()).toEqual(nine.filter((p) => !gone.includes(p)));
    expect(Object.values(s.work).every((units) => units === 2)).toBe(true);
  });

  it("counts the reads that end in one post, and starts the count again with the next post", async () => {
    // Seven calls for one post: the calls spent on a post go up by one with each, and the next post starts at none.
    const s = service(1, 3);
    await readAll(s.io, nine.slice(0, 2));
    expect(s.calls.map((c) => [c.posts[0], c.asks])).toEqual([
      ["c1/post-1.jpg", 0], ["c1/post-1.jpg", 1], ["c1/post-1.jpg", 2],
      ["c1/post-2.jpg", 0], ["c1/post-2.jpg", 1], ["c1/post-2.jpg", 2],
    ]);
  });

  describe("the hard cap on asking again", () => {
    /** A service that never finishes a post and never gets further: every call with a budget is answered unfinished, with or without a point. */
    function stuck(point: boolean) {
      const calls: Array<{ posts: string[]; carried: Carried | null }> = [];
      const io: PictureIo = {
        call: async () => { throw new Error("not used here"); },
        async within(_route, body, carried) {
          calls.push({ posts: (body as { posts: string[] }).posts, carried });
          // What the client does at the cap (client.ts): no budget goes out, so an unfinished answer is refused. Here the service then works to its end.
          if ((carried?.asks ?? 0) >= PICTURE_MAX_ASKS) return { result: { posts: [shows("c1/post-1.jpg")] } as never, ms: 44_000 };
          const search: SearchSoFar = { of: "same", done: [], at: { size: 0, row: 1, best: { x: 0, y: 0, width: 0, height: 0, score: -2 } } };
          return { unfinished: point ? { posts: [], search } : {}, carried: { ...(point ? { search } : carried?.search ? { search: carried.search } : {}), asks: (carried?.asks ?? 0) + 1 }, ms: 20_000 };
        },
        read: async (_bucket, path) => path,
        write: async (_bucket, path) => path,
      };
      return { io, calls };
    }

    it("asks for a post PICTURE_MAX_ASKS times with a budget, then alone and without one, and the read ends", async () => {
      for (const point of [true, false]) {
        const s = stuck(point);
        let reading: Reading | null = null;
        let looks = 0;
        let settled: Array<{ post: string; logo: PostLogo | null }> = [];
        while (!settled.length) {
          if (++looks > PICTURE_MAX_ASKS + 5) throw new Error("the read did not end");
          const looked = await readNextPosts(s.io, { clientId: "c1", unread: nine, placement: PLACE, plan: PLAN, reading });
          settled = looked.read;
          reading = looked.reading;
          if (!settled.length) expect(reading, `look ${looks}`).toMatchObject({ post: "c1/post-1.jpg", asks: looks });
        }
        // Twelve looks that settled nothing, each counted against the post, and the thirteenth settles it.
        expect(looks, `point ${point}`).toBe(PICTURE_MAX_ASKS + 1);
        expect(s.calls.slice(0, PICTURE_MAX_ASKS).every((c) => c.posts.length === POSTS_PER_CALL)).toBe(true);
        // The last call carries every call spent, so the client sends it with no budget, and it asks for that one post only.
        expect(s.calls[PICTURE_MAX_ASKS].carried?.asks).toBe(PICTURE_MAX_ASKS);
        expect(s.calls[PICTURE_MAX_ASKS].posts).toEqual(["c1/post-1.jpg"]);
        expect(settled).toEqual([{ post: "c1/post-1.jpg", logo: shows("c1/post-1.jpg") }]);
        expect(reading).toBeNull();
      }
    });
  });

  it("reads back a kept reading from a step's result, and takes anything else for none", () => {
    const soFar: SearchSoFar = { of: "x", done: [] };
    expect(readingOf({ post: "c1/a.jpg", soFar, asks: 2 })).toEqual({ post: "c1/a.jpg", soFar, asks: 2 });
    expect(readingOf({ post: "c1/a.jpg" })).toEqual({ post: "c1/a.jpg", asks: 0 });
    expect(readingOf({ soFar })).toBeUndefined();
    expect(readingOf(null)).toBeUndefined();
  });
});
