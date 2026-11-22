import { it, expect } from "vitest";
import { formatCount } from "@/lib/platformMeasures";

// 999,950 rounds to 1000.0 in K units; it should cross into M.
it("formatCount never prints 1000.0K", () => {
  expect(formatCount(999_950)).toBe("1.0M");
  expect(formatCount(999_999)).toBe("1.0M");
});
