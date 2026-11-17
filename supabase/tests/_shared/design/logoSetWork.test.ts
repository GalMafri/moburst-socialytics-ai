// @vitest-environment node
// The two picture calls an edge function makes to build a client's logo
// set, with their signed links.
import { describe, expect, it } from "vitest";
import { askLogoSet, askPostLogos, type PictureIo } from "../../../functions/_shared/design/logoSetWork";
import { NotInStorage } from "../../../functions/_shared/picture/client";
import type { LogoSetResult, PostLogosResult } from "../../../functions/_shared/picture/contract";

const FACTS: LogoSetResult = { size: { width: 300, height: 90 }, own: "light", both: false, made: { other: { turned: 1 }, white: null }, site: null, person: null, inks: { stored: [], other: [], white: null } };

/** A picture service that records what it was asked, with links that say what was signed. */
function fakeIo(answer: { set?: LogoSetResult; posts?: PostLogosResult; gone?: string[]; down?: string[] } = {}) {
  const calls: Array<{ route: string; body: Record<string, unknown> }> = [];
  const io: PictureIo = {
    async call(route, body) {
      calls.push({ route, body: body as unknown as Record<string, unknown> });
      return { result: (route === "logo-set" ? answer.set ?? FACTS : answer.posts ?? { posts: [] }) as never, ms: 321 };
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
    expect(got).toEqual({ posts: posts.posts, ms: 321 });
    expect(calls).toEqual([{
      route: "post-logos",
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
    expect(got).toEqual({ posts: [null, null], ms: 0 });
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

  it("answers null for every post when the service gave back another count", async () => {
    const { io } = fakeIo({ posts: { posts: [null] } });
    const got = await askPostLogos(io, { clientId: "c1", posts: ["a.jpg", "b.jpg"], placement: { anchor: "center", width: 0.2, top: 0.04 }, plan: { searches: [{ file: "stored", path: "c1/logo.png", ground: [255, 255, 255] }], compare: [] } });
    expect(got.posts).toEqual([null, null]);
  });
});
