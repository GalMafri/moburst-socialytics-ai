// @vitest-environment node
// One hashtag rule everywhere: # followed by letters, digits or underscores only.
import { describe, expect, it } from "vitest";
import { asHashtag, HASHTAG, hashtagText } from "../../../functions/_shared/trends/hashtag";

describe("asHashtag", () => {
  it("keeps letters in any script, digits and underscores, and puts one # in front", () => {
    for (const [typed, tag] of [
      ["car accident lawyer", "#caraccidentlawyer"], ["##aso", "#aso"], ["  # legal\ttips  ", "#legaltips"], ["#plain", "#plain"],
      ["#café-life!", "#cafélife"], ["#a#b", "#ab"], ["עורך דין", "#עורךדין"], ["#x.y_z", "#xy_z"], ["#Q4_2026", "#Q4_2026"], ["#lawyer🚗", "#lawyer"],
    ] as const) {
      expect(asHashtag(typed), typed).toBe(tag);
      expect(HASHTAG.test(asHashtag(typed)), typed).toBe(true);
    }
  });

  it("is empty when nothing is left", () => {
    for (const typed of ["", "#", "###", " # ", "# #", "#-!", "🚗", "...", "-_-".replace(/_/g, "")]) expect(asHashtag(typed), typed).toBe("");
  });

  it("gives the tag's text without the # for a source that wants it bare", () => {
    expect(hashtagText("#café-life!")).toBe("cafélife");
    expect(hashtagText("#")).toBe("");
  });

  it("is the rule the profile writer and the coverage rewrite check tags against", () => {
    for (const ok of ["#aso", "#עורך_דין", "#Q4_2026"]) expect(HASHTAG.test(ok)).toBe(true);
    for (const bad of ["aso", "#", "# aso", "#café-life", "#a#b"]) expect(HASHTAG.test(bad)).toBe(false);
  });
});
