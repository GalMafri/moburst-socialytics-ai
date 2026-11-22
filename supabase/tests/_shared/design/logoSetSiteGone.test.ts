// @vitest-environment node
// P33-3 (QA 22 Nov 2026): one website logo file gone from storage fails the whole logo-set call (askLogoSet), while a person's
// file that is gone is left out. The lifecycle step then fails on every look, and the set never settles.
import { describe, expect, it } from "vitest";
import { askLogoSet, type PictureIo } from "../../../functions/_shared/design/logoSetWork";
import { NotInStorage } from "../../../functions/_shared/picture/client";

const GONE = "c1/design-settings/logo-site-gone.png";
const calls: string[] = [];
const io: PictureIo = {
  async call(route) { calls.push(route); return { result: {} as never, ms: 1 }; },
  async within() { throw new Error("not used"); },
  read: async (bucket, path) => { if (path === GONE) throw new NotInStorage(`Could not prepare ${path}: Object not found`); return `read:${bucket}/${path}`; },
  write: async (bucket, path) => `write:${bucket}/${path}`,
};

describe("P33 logo set with a website file gone from storage", () => {
  it("makes the set without the missing website file, as it does for a missing person's file", async () => {
    await askLogoSet(io, { clientId: "c1", logoPath: "c1/logo.png", site: [GONE, "c1/design-settings/logo-site-ok.png"], person: null, out: { other: "c1/o.png", white: "c1/w.png" } }).catch(() => undefined);
    expect(calls).toEqual(["logo-set"]);
  });

  it("names the website file the service chose by its place in the list it was given", async () => {
    const sent: unknown[] = [];
    const chose: PictureIo = { ...io, async call(_route, body) { sent.push(body); return { result: { site: { index: 0, overlap: 0.9, size: { width: 10, height: 10 } } } as never, ms: 1 }; } };
    const { facts } = await askLogoSet(chose, { clientId: "c1", logoPath: "c1/logo.png", site: [GONE, "c1/design-settings/logo-site-ok.png"], person: null, out: { other: "c1/o.png", white: "c1/w.png" } });
    const links = (sent[0] as { site: string[] }).site;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(/logo-site-ok\.png$/);
    expect(facts.site?.index).toBe(1);
  });
});
