import { describe, it, expect } from "vitest";
import { KIT_MAX, KIT_MIN, kitCleanPrompt, kitPath, kitPaths, kitPickPrompt, kitState, parseKitPick } from "../../../functions/_shared/video/kit";

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
