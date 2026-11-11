import { describe, it, expect } from "vitest";
import { KIT_BATCH, KIT_EDIT_LONG, KIT_MAKE_MS, KIT_MAX, MAX_KIT_TRIES, kitEditSize, kitStillCheckPrompt, parseKitStillCheck, type KitDone, kitClaim, kitDoneCount, kitDoneOf, kitForStyle, kitKeptFrom, kitWork, KIT_MIN, kitCleanPrompt, kitKept, kitNext, kitPath, kitPaths, kitPickPrompt, kitState, parseKitPick, postsRouteInput, videoRouteFor } from "../../../functions/_shared/video/kit";

describe("kit limits and paths", () => {
  it("keeps at most six stills and needs at least two", () => {
    expect(KIT_MAX).toBe(6);
    expect(KIT_MIN).toBe(2);
  });

  it("stores each still under the client's style folder", () => {
    expect(kitPath("c1", 0)).toBe("c1/style/kit-0.jpg");
    expect(kitPath("c1", 5)).toBe("c1/style/kit-5.jpg");
  });
});

describe("kitState", () => {
  it("is missing when the style has no kit yet", () => {
    expect(kitState(undefined)).toBe("missing");
    expect(kitState(null)).toBe("missing");
    expect(kitState({})).toBe("missing");
  });

  it("is ready with at least two stills", () => {
    expect(kitState({ kit: ["a", "b"] })).toBe("ready");
    expect(kitState({ kit: ["a", "b", "c"] })).toBe("ready");
  });

  it("is none when the kit was made with fewer than two stills", () => {
    expect(kitState({ kit: [] })).toBe("none");
    expect(kitState({ kit: ["a"] })).toBe("none");
  });
});

describe("kitPaths", () => {
  it("returns the kit's paths, and nothing when there is no kit", () => {
    expect(kitPaths({ kit: ["a", "b"] })).toEqual(["a", "b"]);
    expect(kitPaths({ kit: ["a", 3, "", "b"] })).toEqual(["a", "b"]);
    expect(kitPaths(undefined)).toEqual([]);
    expect(kitPaths({ kit: "a" })).toEqual([]);
  });
});

describe("parseKitPick", () => {
  it("drops repeats and indexes out of range, keeping the order", () => {
    expect(parseKitPick("[3, 0, 3, 9]", 8, 6)).toEqual([3, 0]);
  });

  it("is null when no list can be read", () => {
    expect(parseKitPick("no", 8, 6)).toBeNull();
  });

  it("reads the last list among other words and caps it at max", () => {
    expect(parseKitPick("Stills [2, 5] show faces, so: [1, 2, 3, 4]", 8, 3)).toEqual([1, 2, 3]);
    expect(parseKitPick("Faces in [2, 5]. Answer: []", 8, 6)).toEqual([]);
  });

  it("is null when the list has no usable number", () => {
    expect(parseKitPick("[9, 10]", 8, 6)).toBeNull();
  });

  it("reads an empty list as the answer that no still qualifies", () => {
    expect(parseKitPick("[]", 8, 6)).toEqual([]);
    expect(parseKitPick("None of them: []", 8, 6)).toEqual([]);
  });

  it("drops values that are not whole numbers", () => {
    expect(parseKitPick('[1, "2", 2.5, -1, 4]', 8, 6)).toEqual([1, 4]);
  });
});

describe("kitPickPrompt", () => {
  it("asks for 0-based indexes as a JSON array, at most max", () => {
    const p = kitPickPrompt("Pay The Pyper", 8, 6);
    expect(p).toContain("Pay The Pyper");
    expect(p).toContain("These 8 stills");
    expect(p).toContain("numbered 0 to 7");
    expect(p).toContain("Choose up to 6");
    expect(p).toContain("JSON array of the chosen numbers only, at most 6 of them");
  });

  it("leaves out stills with a person's face and allows an empty answer", () => {
    const p = kitPickPrompt("Pay The Pyper", 8, 6);
    expect(p).toMatch(/person's face/);
    expect(p).toContain("Answer [] when no still qualifies");
    expect(p).not.toMatch(/its people|graphics/);
  });
});

describe("kitCleanPrompt", () => {
  it("removes all text and marks and names no words, not even the brand", () => {
    const p = kitCleanPrompt();
    for (const w of ["captions", "subtitles", "logos", "watermarks", "screens"]) expect(p).toContain(w);
    expect(p).toMatch(/No lettering of any kind stays/);
    expect(p).toMatch(/nothing new is added/);
    // The kit never carries the client's scene words or name: naming words made the model paint them.
    expect(p).not.toMatch(/stays is|spelled exactly|scene_words|only lettering|\$\{/);
    expect(kitCleanPrompt.length).toBe(0);
  });

  it("has no em or en dashes", () => {
    for (const p of [kitCleanPrompt(), kitPickPrompt("B", 4, 2), kitStillCheckPrompt()]) expect(p).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("kitEditSize", () => {
  it("keeps the still's own aspect with the longest side at 1536, both sides multiples of 16", () => {
    expect(KIT_EDIT_LONG).toBe(1536);
    expect(kitEditSize(540, 304)).toEqual([1536, 864]);
    expect(kitEditSize(1080, 1920)).toEqual([864, 1536]);
    expect(kitEditSize(1000, 1000)).toEqual([1536, 1536]);
    expect(kitEditSize(1920, 1080)).toEqual([1536, 864]);
  });

  it("never asks for a side under 16", () => {
    expect(kitEditSize(3000, 10)).toEqual([1536, 16]);
    expect(kitEditSize(0, 0)).toEqual([1536, 1536]);
  });
});

describe("kit still read-back", () => {
  it("asks about writing and a person's face and wants JSON", () => {
    const p = kitStillCheckPrompt();
    expect(p).toMatch(/writing/i);
    expect(p).toMatch(/person's face/);
    expect(p).toContain('"face": true or false');
  });

  it("reads both answers and where, and is null when one is missing", () => {
    expect(parseKitStillCheck('{"writing": false, "face": true, "where": "a man at a desk"}')).toEqual({ writing: false, face: true, where: "a man at a desk" });
    expect(parseKitStillCheck('Sure. {"writing": "true", "face": "false", "where": ""}')).toEqual({ writing: true, face: false, where: "" });
    expect(parseKitStillCheck('{"writing": false}')).toBeNull();
    expect(parseKitStillCheck("no idea")).toBeNull();
  });
});

describe("videoRouteFor", () => {
  it("takes the posts route when the kit was made with too few stills", () => {
    expect(videoRouteFor({ kit: [] }, null)).toBe("posts");
    expect(videoRouteFor({ kit: [] }, "posts")).toBe("posts");
  });

  it("keeps the requested route when the kit is ready", () => {
    expect(videoRouteFor({ kit: ["a", "b"] }, null)).toBeNull();
    expect(videoRouteFor({ kit: ["a", "b"] }, "posts")).toBe("posts");
  });

  it("does not route around a kit that is not made yet", () => {
    expect(videoRouteFor(undefined, null)).toBeNull();
    expect(videoRouteFor({ profile: {} }, null)).toBeNull();
  });
});

describe("kitNext", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("is ready or none once a kit is stored", () => {
    expect(kitNext({ kit: ["a", "b"] }, now)).toBe("ready");
    expect(kitNext({ kit: ["a"], kit_started_at: ago(60_000), kit_job: "j2" }, now, "j1")).toBe("none");
  });

  it("makes the kit when nobody has started it", () => {
    expect(kitNext({ frames: ["f"] }, now, "j1")).toBe("make");
    expect(kitNext(undefined, now, "j1")).toBe("make");
    expect(kitNext({ kit_started_at: "not a time" }, now, "j1")).toBe("make");
  });

  it("waits while another job is making it", () => {
    expect(kitNext({ kit_started_at: ago(60_000), kit_job: "j2" }, now, "j1")).toBe("wait");
    expect(kitNext({ kit_started_at: ago(60_000), kit_job: "j2" }, now)).toBe("wait");
  });

  it("makes it again when the other job started more than 15 minutes ago", () => {
    expect(KIT_MAKE_MS).toBe(15 * 60_000);
    expect(kitNext({ kit_started_at: ago(KIT_MAKE_MS + 1), kit_job: "j2" }, now, "j1")).toBe("make");
  });

  it("goes on with its own start unless its own cleaning is still running", () => {
    const vs = { kit_started_at: ago(60_000), kit_job: "j1" };
    expect(kitNext(vs, now, "j1")).toBe("make");
    expect(kitNext(vs, now, "j1", now - 60_000)).toBe("wait");
    expect(kitNext(vs, now, "j1", now - KIT_MAKE_MS - 1)).toBe("make");
  });
});

describe("kitKept", () => {
  it("keeps the clean stills in pick order, or none with fewer than KIT_MIN", () => {
    expect(kitKept(["a", null, "c"])).toEqual(["a", "c"]);
    expect(kitKept(["a", null, null])).toEqual([]);
    expect(kitKept([])).toEqual([]);
  });
});

describe("postsRouteInput", () => {
  it("drops everything taken from the client's filmed videos", () => {
    const input = { kind: "video", copy: ["Hi"], video_route: null, show_logo: false, logo_at: "end", logo_width: 0.3, people: "fictional", footage_upload: null };
    const out = postsRouteInput(input);
    expect(out).toEqual({ kind: "video", copy: ["Hi"], video_route: "posts", show_logo: true, logo_at: null, logo_width: null, people: "none", footage_upload: null });
    expect(input.video_route).toBeNull();
  });
});

describe("kitDoneOf", () => {
  it("reads each finished still by its index, and nothing else", () => {
    expect(kitDoneOf({ "0": { path: "p0" }, "2": { dropped: true }, "3": null, "4": { path: "" }, x: { path: "q" }, "5": "p5" })).toEqual({ "0": { path: "p0" }, "2": { dropped: true } });
    expect(kitDoneOf(undefined)).toEqual({});
    expect(kitDoneOf(["p0", null])).toEqual({});
  });

  it("keeps the stills not finished as pending after the state is saved and read back", () => {
    const state = { kit_done: { "2": { path: "c/style/kit-2.jpg" } } as KitDone };
    const back = JSON.parse(JSON.stringify(state));
    const done = kitDoneOf(back.kit_done);
    expect(kitDoneCount(done)).toBe(1);
    expect(kitWork(3, done, 0)).toEqual({ kind: "clean", todo: [0, 1] });
  });
});

describe("kitKeptFrom", () => {
  it("lists the clean stills in pick order, or none with fewer than KIT_MIN", () => {
    expect(kitKeptFrom(4, { "3": { path: "d" }, "0": { path: "a" }, "1": { dropped: true } })).toEqual(["a", "d"]);
    expect(kitKeptFrom(3, { "0": { path: "a" }, "1": { dropped: true }, "2": { dropped: true } })).toEqual([]);
  });
});

describe("kitWork", () => {
  it("cleans at most three stills not done yet, in pick order", () => {
    expect(KIT_BATCH).toBe(3);
    expect(kitWork(6, {}, 1)).toEqual({ kind: "clean", todo: [0, 1, 2] });
    expect(kitWork(6, { "0": { path: "a" }, "1": { dropped: true }, "2": { path: "c" } }, 2)).toEqual({ kind: "clean", todo: [3, 4, 5] });
    expect(kitWork(6, { "0": { path: "a" }, "2": { path: "c" }, "3": { dropped: true } }, 2)).toEqual({ kind: "clean", todo: [1, 4, 5] });
  });

  it("stores the kit once every picked still is done, even on a late try", () => {
    expect(kitWork(3, { "0": { path: "a" }, "1": { dropped: true }, "2": { path: "c" } }, 1)).toEqual({ kind: "store" });
    expect(kitWork(2, { "0": { path: "a" }, "1": { path: "b" } }, MAX_KIT_TRIES + 5)).toEqual({ kind: "store" });
    expect(kitWork(0, {}, 1)).toEqual({ kind: "store" });
  });

  it("gives up after three tries with stills still to clean", () => {
    expect(MAX_KIT_TRIES).toBe(3);
    expect(kitWork(6, { "0": { path: "a" } }, MAX_KIT_TRIES - 1)).toEqual({ kind: "clean", todo: [1, 2, 3] });
    expect(kitWork(6, { "0": { path: "a" } }, MAX_KIT_TRIES)).toEqual({ kind: "spent" });
  });

  it("asks for the pick when there is none yet, unless the tries are spent", () => {
    expect(kitWork(null, {}, 0)).toEqual({ kind: "pick" });
    expect(kitWork(null, {}, MAX_KIT_TRIES)).toEqual({ kind: "spent" });
  });
});

describe("kit tries", () => {
  // One claim each: its tries from what was done before it, then what kitWork
  // decides; `adds` is how many stills its hold finished, -1 for a claim that
  // fails before its pick. The state goes through JSON between claims, as it does in the row.
  function run(passes: number[]): Array<string> {
    let state: { done: KitDone; picked: boolean; prev: { tries?: number; seen?: number } } = { done: {}, picked: false, prev: {} };
    const out: string[] = [];
    for (const adds of passes) {
      state.prev = kitClaim(state.prev, kitDoneCount(state.done));
      let work = kitWork(state.picked ? 6 : null, state.done, state.prev.tries ?? 0);
      if (work.kind === "pick") {
        if (adds < 0) { out.push("pick failed"); state = JSON.parse(JSON.stringify(state)); continue; }
        state.picked = true;
        work = kitWork(6, state.done, state.prev.tries ?? 0);
      }
      out.push(work.kind);
      if (work.kind !== "clean") break;
      // Out of order, as parallel stills finish: the last of the batch first.
      for (const i of work.todo.slice(-Math.max(0, adds)).reverse()) if (adds > 0) state.done[String(i)] = { path: `k${i}` };
      state = JSON.parse(JSON.stringify(state));
    }
    return out;
  }

  it("spends no try on the three normal claims of six stills", () => {
    expect(run([3, 3, 0])).toEqual(["clean", "clean", "store"]);
  });

  it("stores [] after three claims that each finish nothing", () => {
    expect(run([0, 0, 0, 0])).toEqual(["clean", "clean", "clean", "spent"]);
  });

  it("stores [] after three claims that each fail before the pick", () => {
    expect(run([-1, -1, -1, -1])).toEqual(["pick failed", "pick failed", "pick failed", "spent"]);
  });

  it("counts only the claims that finished nothing, and retries stills left pending", () => {
    // progress, busy, progress, busy, progress: two tries, and the kit is stored.
    expect(run([2, 0, 2, 0, 2, 0])).toEqual(["clean", "clean", "clean", "clean", "clean", "store"]);
  });

  it("costs the first claim nothing and keeps the count across claims", () => {
    expect(kitClaim({}, 0)).toEqual({ tries: 0, seen: 0 });
    expect(kitClaim({ tries: 0, seen: 0 }, 0)).toEqual({ tries: 1, seen: 0 });
    expect(kitClaim({ tries: 1, seen: 0 }, 3)).toEqual({ tries: 1, seen: 3 });
  });
});

describe("kitForStyle", () => {
  it("keeps a kit in progress made from the same style", () => {
    const s = { kit_of: "2026-11-10T10:00:00Z", kit_pick: ["f0"], kit_done: { "0": { path: "a" } }, kit_seen: 1, kit_tries: 1, other: 1 };
    expect(kitForStyle(s, "2026-11-10T10:00:00Z")).toBe(s);
  });

  it("starts the pick again when the style was learned again", () => {
    const s = { kit_of: "2026-11-10T10:00:00Z", kit_pick: ["f0"], kit_done: { "0": { path: "a" } }, kit_seen: 1, kit_tries: 1, other: 1 };
    expect(kitForStyle(s, "2026-11-11T09:00:00Z")).toEqual({ kit_of: "2026-11-11T09:00:00Z", kit_tries: 1, other: 1 });
  });

  it("ties a first claim to the style it starts from", () => {
    expect(kitForStyle({}, "2026-11-10T10:00:00Z")).toEqual({ kit_of: "2026-11-10T10:00:00Z" });
    expect(kitForStyle({}, undefined)).toEqual({ kit_of: null });
  });
});
