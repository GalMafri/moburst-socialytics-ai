import { describe, it, expect } from "vitest";
import { GROUND_FRAMES, GROUND_MAX_MS, GROUND_POLL_MS, GROUND_TRIES, type GroundDeps, centeredIn, chooseVideoLogo, pickVideoLogo, groundRect, groundsOf, groundsScript, parseGrounds, stampFor, videoStampFiles } from "../../../functions/_shared/video/logoGround";

// A wordmark in white with a red mark (the stored file, made for dark grounds), and the client's own dark copy of it.
const WHITE_INKS: Array<[number, number, number]> = [[255, 255, 255], [200, 30, 40]];
const DARK_INKS: Array<[number, number, number]> = [[22, 22, 26], [200, 30, 40]];
const files = [
  { file: "stored" as const, path: "c/logo.png", inks: WHITE_INKS, size: [600, 200] as [number, number] },
  { file: "other" as const, path: "c/logo-dark.png", inks: DARK_INKS, size: [600, 200] as [number, number] },
];
const own = { path: "c/logo.png", size: [600, 200] as [number, number] };
const WHITE_DESK: [number, number, number] = [244, 243, 240];
const PINK_COUNTER: [number, number, number] = [246, 226, 228];
const DARK_ROOM: [number, number, number] = [24, 26, 32];

const set = {
  of: "c/logo.png", rule: 2, own: "dark", both: false, inks: WHITE_INKS,
  other: { path: "c/logo-dark.png", from: "site", size: [600, 200] }, white: null,
  made: { other: "c/made-other.png", white: null }, site: "c/logo-dark.png",
  posts: { read: 6, found: 5, shown: { stored: 5, other: 0, white: 0 } },
  canvas: { file: "stored", ground: "#101010", from: "client_posts" }, at: "2026-11-17T00:00:00Z",
};

describe("the video's logo file, chosen by the footage's ground", () => {
  it("a light ground under the logo takes the client's dark copy, not the white wordmark", () => {
    const p = chooseVideoLogo(files, [WHITE_DESK, WHITE_DESK, [236, 236, 230], WHITE_DESK], own);
    expect(p.file).toBe("other");
    expect(p.path).toBe("c/logo-dark.png");
    expect(p.by).toBe("grounds");
    expect(p.shows!.stored!).toBeLessThan(1.5);
  });

  it("a pink-white counter is a light ground too", () => {
    expect(chooseVideoLogo(files, [PINK_COUNTER], own).file).toBe("other");
  });

  it("a dark ground keeps the stored white wordmark", () => {
    const p = chooseVideoLogo(files, [DARK_ROOM, [40, 38, 44]], own);
    expect(p.file).toBe("stored");
    expect(p.path).toBe("c/logo.png");
  });

  it("the weakest frame decides: a file that is lost on any frame is not carried", () => {
    // Light and dark frames: neither file shows on both, so the job's own file stays, as before.
    const p = chooseVideoLogo(files, [WHITE_DESK, DARK_ROOM], own);
    expect(p.file).toBeNull();
    expect(p.path).toBe(own.path);
    expect(p.by).toBe("none");
  });

  it("no ground read keeps the job's own file", () => {
    expect(chooseVideoLogo(files, [], own)).toEqual({ file: null, path: own.path, size: own.size, by: "unread" });
  });

  it("a copy the client's posts never show is tried after its own files", () => {
    const withLast = [{ ...files[0] }, { ...files[1], last: true as const }, { file: "white" as const, path: "c/w.png", inks: DARK_INKS, size: [600, 200] as [number, number] }];
    expect(chooseVideoLogo(withLast, [WHITE_DESK], own).file).toBe("white");
  });

  it("the picked file's own size is kept, so it is placed in its own proportions", () => {
    const tall = [files[0], { ...files[1], size: [300, 300] as [number, number] }];
    expect(chooseVideoLogo(tall, [WHITE_DESK], own).size).toEqual([300, 300]);
  });
});

describe("which files a video may carry", () => {
  const row = { logo_path: "c/logo.png", logo_set: set };
  it("a job started now keeps the files of its list that the client's set still holds", () => {
    const stamp = [{ file: "stored", path: "c/logo.png" }, { file: "other", path: "c/logo-dark.png" }];
    expect(videoStampFiles({ logo_path: "c/logo.png", stamp }, row)).toEqual(stamp);
  });

  it("a client with only one file: the video has that file alone and nothing is chosen", () => {
    expect(videoStampFiles({ logo_path: "c/logo.png", stamp: [{ file: "stored", path: "c/logo.png" }] }, row)).toEqual([{ file: "stored", path: "c/logo.png" }]);
    expect(videoStampFiles({ logo_path: "c/logo.png" }, { logo_path: "c/logo.png", logo_set: null })).toEqual([{ file: "stored", path: "c/logo.png" }]);
    expect(videoStampFiles({ logo_path: "c/logo.png", stamp: [{ file: "stored", path: "c/logo.png" }, { file: "other", path: "c/logo-dark.png" }] }, null)).toEqual([{ file: "stored", path: "c/logo.png" }]);
  });

  it("a job already in flight (no list) reads the client's set as it is now, when it is still the job's file", () => {
    const list = videoStampFiles({ logo_path: "c/logo.png" }, row);
    expect(list.map((f) => f.file)).toEqual(["stored", "other"]);
    expect(list[1].path).toBe("c/logo-dark.png");
  });

  it("a job in flight whose client changed its logo since keeps its own one file", () => {
    expect(videoStampFiles({ logo_path: "c/old.png" }, row)).toEqual([{ file: "stored", path: "c/old.png" }]);
    expect(stampFor("c/logo.png", { logo_path: "c/logo.png", logo_set: { ...set, of: "c/older.png" } })).toBeNull();
  });

  it("reads a set only under a rule that is read, as the stills do", () => {
    expect(stampFor("c/logo.png", { logo_path: "c/logo.png", logo_set: { ...set, rule: 99 } })).toBeNull();
    expect(stampFor("c/logo.png", { logo_path: "c/logo.png", logo_set: { ...set, rule: 1 } })).not.toBeNull();
  });

  it("never stamps a person's file the team removed", () => {
    const person = { ...set, other: { path: "c/person.png", from: "person", size: [600, 200] } };
    const kept = { ...person, person: { path: "c/person.png", of: "c/logo.png", at: "2026-11-10T00:00:00Z" } };
    expect(stampFor("c/logo.png", { logo_path: "c/logo.png", logo_set: kept })!.map((f) => f.path)).toContain("c/person.png");
    // Removed: the person key no longer names the file, or names it for another logo.
    expect(stampFor("c/logo.png", { logo_path: "c/logo.png", logo_set: person })).toBeNull();
    expect(stampFor("c/logo.png", { logo_path: "c/logo.png", logo_set: { ...person, person: { path: "c/person.png", of: "c/older.png", at: "x" } } })).toBeNull();
    // A job that started with that file carries it, and does not stamp it once it is gone.
    const stamp = [{ file: "stored", path: "c/logo.png" }, { file: "other", path: "c/person.png" }];
    expect(videoStampFiles({ logo_path: "c/logo.png", stamp }, { logo_path: "c/logo.png", logo_set: person })).toEqual([{ file: "stored", path: "c/logo.png" }]);
  });
});

describe("reading the footage under the logo's place", () => {
  it("cuts the place out of frames filled into a landscape frame, over the whole clip", () => {
    const uploads = Array.from({ length: GROUND_FRAMES }, (_, i) => `https://s/up${i}?t=a'b`);
    const script = groundsScript({ footageUrl: "https://s/clip.mp4", frame: { width: 1920, height: 1080 }, rect: { x: 1500, y: 60, width: 340, height: 113 }, end: false, uploads });
    expect(script).toContain("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    expect(script).toContain("crop=340:113:1500:60");
    expect(script).toContain("d * 0.1250");
    expect(script).toContain("d * 0.8750");
    expect(script.split("--data-binary @ground").length - 1).toBe(GROUND_FRAMES);
    expect(script.trim().split("\n").pop()).toBe(`echo "GROUNDS ${GROUND_FRAMES}"`);
  });

  it("reads a closing logo's place only over the close, in a vertical frame", () => {
    const script = groundsScript({ footageUrl: "https://s/clip.mp4", frame: { width: 1080, height: 1920 }, rect: { x: 300, y: 860, width: 480, height: 160 }, end: true, uploads: ["https://s/a", "https://s/b"] });
    expect(script).toContain("scale=1080:1920");
    expect(script).toContain("s = d - 1.6");
    expect(script).toContain("crop=480:160:300:860");
  });

  it("knows when every frame came back", () => {
    expect(parseGrounds("GROUNDS 4", 4)).toBe(true);
    expect(parseGrounds("GROUNDS 3", 4)).toBe(false);
    expect(parseGrounds("FAILED: curl", 4)).toBe(false);
  });

  it("keeps the place inside the frame", () => {
    expect(groundRect({ x: -10, y: 20, width: 200 }, 50, { width: 1080, height: 1920 })).toEqual({ x: 0, y: 20, width: 190, height: 50 });
    expect(groundRect({ x: 2000, y: 20, width: 200 }, 50, { width: 1080, height: 1920 })).toBeNull();
  });

  it("reads each frame's ground as a real pixel of it", () => {
    const raster = (c: [number, number, number]) => {
      const data = new Uint8ClampedArray(20 * 10 * 4);
      for (let i = 0; i < 200; i++) data.set([c[0], c[1], c[2], 255], i * 4);
      return { width: 20, height: 10, data };
    };
    expect(groundsOf([raster(WHITE_DESK), raster(DARK_ROOM)])).toEqual([WHITE_DESK, DARK_ROOM]);
  });
});

// ── The pick, with its services faked ──────────────────────────────────────

const flat = (c: [number, number, number]) => {
  const data = new Uint8ClampedArray(40 * 12 * 4);
  for (let i = 0; i < 480; i++) data.set([c[0], c[1], c[2], 255], i * 4);
  return { width: 40, height: 12, data };
};

type Phase = "row" | "footage" | "uploads" | "start" | "check" | "frame" | "logo" | "none";

function fake(opts: { ground?: [number, number, number]; fail?: Phase; failAlways?: boolean; running?: boolean } = {}) {
  let clock = 1_000_000, failures = 0;
  const calls: string[] = [];
  const boom = (phase: Phase) => {
    if (opts.fail === phase && (opts.failAlways !== false || failures++ === 0)) throw new Error(`${phase} broke`);
  };
  const deps: GroundDeps = {
    liveRow: async () => { boom("row"); return { logo_path: "c/logo.png", logo_set: set }; },
    footageUrl: async () => { boom("footage"); return "https://s/clip.mp4"; },
    prepareUploads: async (n) => { boom("uploads"); return { paths: Array.from({ length: n }, (_, i) => `g${i}.png`), uploads: Array.from({ length: n }, (_, i) => `https://s/u${i}`) }; },
    start: async () => { boom("start"); calls.push("start"); return "sess"; },
    check: async () => { boom("check"); calls.push("check"); return opts.running ? { state: "running" } : { state: "finished", reply: `GROUNDS ${GROUND_FRAMES}` }; },
    end: async () => { calls.push("end"); throw new Error("already gone"); },
    save: async () => { calls.push("save"); },
    readFrame: async () => { boom("frame"); return flat(opts.ground ?? WHITE_DESK); },
    readLogo: async (path) => { if (opts.fail === "logo" && path === "c/logo-dark.png") throw new Error("bad png"); return path === "c/logo.png" ? { inks: WHITE_INKS, size: [600, 200] } : { inks: DARK_INKS, size: [600, 200] }; },
    now: () => clock,
    log: () => {},
  };
  return { deps, calls, tick: (ms = GROUND_POLL_MS + 1) => { clock += ms; } };
}

const jobInput = { logo_path: "c/logo.png", logo_size: [600, 200] as [number, number], stamp: [{ file: "stored", path: "c/logo.png" }, { file: "other", path: "c/logo-dark.png" }] };
const corner = { x: 1500, y: 60, width: 340, end: false };
const LANDSCAPE = { width: 1920, height: 1080 };

/** Runs the pick pass after pass, as the worker does, until it answers; it must never throw. */
async function settle(f: ReturnType<typeof fake>, state: Record<string, any> = {}, input: any = jobInput, box = corner, frame = LANDSCAPE) {
  for (let pass = 0; pass < 40; pass++) {
    const got = await pickVideoLogo(f.deps, state, input, box, frame);
    if (got) return { got, state, passes: pass + 1 };
    f.tick();
  }
  throw new Error("the pick never answered");
}

describe("pickVideoLogo", () => {
  it("light footage: cuts the frames once and carries the dark copy", async () => {
    const f = fake({ ground: WHITE_DESK });
    const { got, state } = await settle(f);
    expect(got.path).toBe("c/logo-dark.png");
    expect(got.by).toBe("grounds");
    expect(f.calls.filter((c) => c === "start")).toHaveLength(1);
    expect(state.logo_ground.session).toBeUndefined();
    // The session is let go of and saved before it is ended.
    expect(f.calls.indexOf("save", f.calls.indexOf("check"))).toBeLessThan(f.calls.lastIndexOf("end"));
  });

  it("dark footage, vertical frame with a closing logo: carries the stored white file", async () => {
    const f = fake({ ground: DARK_ROOM });
    const { got } = await settle(f, {}, jobInput, { x: 300, y: 860, width: 480, end: true }, { width: 1080, height: 1920 });
    expect(got.path).toBe("c/logo.png");
    expect(got.file).toBe("stored");
  });

  it("a client with one file: no frame is cut and its file is carried, as before", async () => {
    const f = fake();
    const got = await pickVideoLogo(f.deps, {}, { logo_path: "c/logo.png", logo_size: [600, 200], stamp: [{ file: "stored", path: "c/logo.png" }] }, corner, LANDSCAPE);
    expect(got).toEqual({ file: null, path: "c/logo.png", size: [600, 200], by: "one" });
    expect(f.calls).toEqual([]);
  });

  it("a job in flight with no list reads the live set and still picks", async () => {
    const f = fake({ ground: PINK_COUNTER });
    const { got } = await settle(f, {}, { logo_path: "c/logo.png", logo_size: [600, 200] });
    expect(got.path).toBe("c/logo-dark.png");
  });

  for (const phase of ["footage", "uploads", "start", "check", "frame"] as const) {
    it(`an error at ${phase}, every time, never throws and ends with the job's own file after ${GROUND_TRIES} tries`, async () => {
      const f = fake({ fail: phase });
      const { got, state } = await settle(f);
      expect(got.path).toBe("c/logo.png");
      expect(got.by).toBe("unread");
      expect(got.why).toContain(`${phase} broke`);
      expect(state.logo_ground.tries).toBe(GROUND_TRIES);
      expect(state.logo_ground.session).toBeUndefined();
    });

    it(`an error at ${phase} once is tried again and the pick still happens`, async () => {
      const f = fake({ fail: phase, failAlways: false, ground: WHITE_DESK });
      const { got } = await settle(f);
      expect(got.path).toBe("c/logo-dark.png");
    });
  }

  it("a settings row that cannot be read leaves the job's own file, with no frame cut", async () => {
    const f = fake({ fail: "row" });
    const got = await pickVideoLogo(f.deps, {}, jobInput, corner, LANDSCAPE);
    expect(got).toMatchObject({ path: "c/logo.png", by: "one" });
  });

  it("a second file whose pixels cannot be read is left out", async () => {
    const f = fake({ fail: "logo", ground: WHITE_DESK });
    const { got } = await settle(f);
    // Only the stored white wordmark was readable, and it does not show on white: the job's own file.
    expect(got.path).toBe("c/logo.png");
    expect(got.by).toBe("none");
  });

  it("a cut still running after the time bound is ended and the job's own file is carried, with no try spent again", async () => {
    const f = fake({ running: true });
    const state: Record<string, any> = {};
    expect(await pickVideoLogo(f.deps, state, jobInput, corner, LANDSCAPE)).toBeNull();
    f.tick(GROUND_MAX_MS - 60_000);
    expect(await pickVideoLogo(f.deps, state, jobInput, corner, LANDSCAPE)).toBeNull();
    f.tick(120_000);
    const got = await pickVideoLogo(f.deps, state, jobInput, corner, LANDSCAPE);
    expect(got).toMatchObject({ path: "c/logo.png", by: "timeout" });
    expect(f.calls.filter((c) => c === "start")).toHaveLength(1);
    expect(f.calls).toContain("end");
    expect(state.logo_ground.session).toBeUndefined();
  });
});

describe("placing a file of another shape", () => {
  it("keeps the middle of the stored file's place", () => {
    const slot = { x: 100, y: 60, width: 300 };
    expect(centeredIn({ x: 100, y: 60, width: 300 }, [300, 150], slot, [600, 200])).toEqual({ x: 100, y: 35, width: 300 });
    expect(centeredIn({ x: 100, y: 60, width: 300 }, [600, 200], slot, [600, 200])).toEqual(slot);
  });
});
