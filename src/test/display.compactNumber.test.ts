// P14-03: compactNumber rounds 999,950..999,999 up to "1000K" instead of switching to millions.
import { it, expect } from "vitest";
import { compactNumber } from "@/lib/display";

it("a figure just under a million reads 1M, never 1000K", () => {
  expect(compactNumber(999_960)).toBe("1M");
});
