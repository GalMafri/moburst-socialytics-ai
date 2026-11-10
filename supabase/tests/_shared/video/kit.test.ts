import { describe, it, expect } from "vitest";
import { KIT_BATCH, KIT_MAKE_MS, KIT_MAX, MAX_KIT_TRIES, kitClaim, kitDoneCount, kitWork, KIT_MIN, kitChosen, kitCleanPrompt, kitKept, kitNext, kitPath, kitPaths, kitPickPrompt, kitState, parseKitPick, postsRouteInput, videoRouteFor } from "../../../functions/_shared/video/kit";

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

  it("reads the first list among other words and caps it at max", () => {
    expect(parseKitPick("Here you go: [1, 2, 3, 4] and [5]", 8, 3)).toEqual([1, 2, 3]);
  });

  it("is null when the list has no usable number", () => {
    expect(parseKitPick("[9, 10]", 8, 6)).toBeNull();
    expect(parseKitPick("[]", 8, 6)).toBeNull();
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
});

describe("kitCleanPrompt", () => {
  it("removes text and marks but keeps the scene's own names spelled as given", () => {
    const p = kitCleanPrompt("Pay The Pyper", ["PAY THE PYPER"]);
    expect(p).toContain("PAY THE PYPER");
    for (const w of ["captions", "subtitles", "logos"]) expect(p).toContain(w);
  });

  it("says no lettering stays when there are no scene words", () => {
    const p = kitCleanPrompt("Pay The Pyper", []);
    expect(p).toMatch(/no lettering/i);
    for (const w of ["captions", "subtitles", "logos"]) expect(p).toContain(w);
  });

  it("has no em or en dashes", () => {
    for (const p of [kitCleanPrompt("B", ["X"]), kitCleanPrompt("B", []), kitPickPrompt("B", 4, 2)]) expect(p).not.toMatch(/[\u2013\u2014]/);
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

describe("kitChosen", () => {
  it("uses the model's pick when it can be read", () => {
    expect(kitChosen("[4, 1]", 9, 6)).toEqual([4, 1]);
  });

  it("falls back to the first stills, at most max", () => {
    expect(kitChosen("sorry", 9, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(kitChosen("sorry", 3, 6)).toEqual([0, 1, 2]);
    expect(kitChosen("sorry", 0, 6)).toEqual([]);
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
    const input = { kind: "video", copy: ["Hi"], video_route: null, show_logo: false, logo_at: "end", logo_width: 0.3, people: "fictional", scene_words: ["FC X"], footage_upload: null };
    const out = postsRouteInput(input);
    expect(out).toEqual({ kind: "video", copy: ["Hi"], video_route: "posts", show_logo: true, logo_at: null, logo_width: null, people: "none", scene_words: [], footage_upload: null });
    expect(input.video_route).toBeNull();
  });
});

describe("kitWork", () => {
  it("cleans at most three stills not done yet, in pick order", () => {
    expect(KIT_BATCH).toBe(3);
    expect(kitWork(6, [], 1)).toEqual({ kind: "clean", todo: [0, 1, 2] });
    expect(kitWork(6, ["a", null, "c"], 2)).toEqual({ kind: "clean", todo: [3, 4, 5] });
    expect(kitWork(6, ["a", undefined, "c", null], 2)).toEqual({ kind: "clean", todo: [1, 4, 5] });
  });

  it("stores the kit once every picked still is done, even on a late try", () => {
    expect(kitWork(3, ["a", null, "c"], 1)).toEqual({ kind: "store" });
    expect(kitWork(2, ["a", "b"], MAX_KIT_TRIES + 5)).toEqual({ kind: "store" });
    expect(kitWork(0, [], 1)).toEqual({ kind: "store" });
  });

  it("gives up after three tries with stills still to clean", () => {
    expect(MAX_KIT_TRIES).toBe(3);
    expect(kitWork(6, ["a"], MAX_KIT_TRIES - 1)).toEqual({ kind: "clean", todo: [1, 2, 3] });
    expect(kitWork(6, ["a"], MAX_KIT_TRIES)).toEqual({ kind: "spent" });
  });
});

describe("kit tries", () => {
  // One claim: its tries from what was done before it, then what kitWork decides; `adds` is how many stills its hold finished.
  function run(passes: number[]): Array<string> {
    const done: Array<string | null | undefined> = [];
    let prev: { tries?: number; seen?: number } = {};
    const out: string[] = [];
    for (const adds of passes) {
      prev = kitClaim(prev, kitDoneCount(done));
      const work = kitWork(6, done, prev.tries);
      out.push(work.kind);
      if (work.kind !== "clean") break;
      for (const i of work.todo.slice(0, adds)) done[i] = `k${i}`;
    }
    return out;
  }

  it("spends no try on the three normal claims of six stills", () => {
    expect(run([3, 3, 0])).toEqual(["clean", "clean", "store"]);
  });

  it("stores [] after three claims that each finish nothing", () => {
    expect(run([0, 0, 0, 0])).toEqual(["clean", "clean", "clean", "spent"]);
  });

  it("counts only the claims that finished nothing", () => {
    // progress, busy, progress, busy, progress: two tries, and the kit is stored.
    expect(run([2, 0, 2, 0, 2, 0])).toEqual(["clean", "clean", "clean", "clean", "clean", "store"]);
    // a dropped still counts as finished.
    expect(kitDoneCount(["a", null, undefined])).toBe(2);
  });

  it("costs the first claim nothing and keeps the count across claims", () => {
    expect(kitClaim({}, 0)).toEqual({ tries: 0, seen: 0 });
    expect(kitClaim({ tries: 0, seen: 0 }, 0)).toEqual({ tries: 1, seen: 0 });
    expect(kitClaim({ tries: 1, seen: 0 }, 3)).toEqual({ tries: 1, seen: 3 });
  });
});
