import { describe, expect, it } from "vitest";
import { hintMayPersist } from "../../functions/post-preview/hints";

describe("hintMayPersist", () => {
  const hinted = { url: "https://www.instagram.com/p/abc123/", image: "https://scontent.cdninstagram.com/a.jpg" };

  it("does not store a hint from a caller who is not staff", () => {
    expect(hintMayPersist(hinted, false)).toBe(false);
  });

  it("stores the same hint from staff", () => {
    expect(hintMayPersist(hinted, true)).toBe(true);
  });

  it("stores a result that carries no image from the caller", () => {
    expect(hintMayPersist({ url: hinted.url }, false)).toBe(true);
  });
});
