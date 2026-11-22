// @vitest-environment node
// P34-02 (QA 22 Nov 2026): readable() folds quote and dash styles but not the ellipsis or
// invisible direction marks, so a correctly drawn headline fails the check.
import { describe, expect, it } from "vitest";
import { copyMatches } from "../../../functions/_shared/design/pipeline";

describe("P34-02 headline compare: typographic gaps", () => {
  it("an ellipsis read as three dots still matches", () => {
    expect(copyMatches(["Wait for it..."], ["Wait for it…"])).toBe(true);
  });
  it("a Hebrew headline carrying a right-to-left mark matches the same words read back", () => {
    expect(copyMatches(["שלום עולם"], ["‏שלום עולם"])).toBe(true);
  });
});
