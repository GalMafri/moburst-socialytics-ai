import { describe, expect, it } from "vitest";
import { headlineFrom } from "../../../supabase/functions/_shared/design-prompts/headline";

describe("headlineFrom", () => {
  it("stops before a list colon", () => {
    expect(headlineFrom("3 things our attorneys would never do after a car accident:\n\n1. Talk to the insurer")).toBe(
      "3 things our attorneys would never do after a car accident",
    );
  });
  it("keeps a short sentence whole and drops hashtags", () => {
    expect(headlineFrom("Growth doesn't happen by chance. It's engineered. #growth")).toBe("Growth doesn't happen by chance");
  });
  it("never ends on a connective", () => {
    expect(headlineFrom("Here is what to do after a crash when the other driver leaves the scene quietly")).not.toMatch(/\b(after|when|the|a)$/);
  });
  it("is empty for empty copy", () => {
    expect(headlineFrom("")).toBe("");
    expect(headlineFrom(null)).toBe("");
  });
});
