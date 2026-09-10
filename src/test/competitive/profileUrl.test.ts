import { describe, expect, it } from "vitest";
import { classifyProfileUrl } from "@/lib/profileUrl";

describe("classifyProfileUrl", () => {
  it("reads a pasted profile link on every platform", () => {
    expect(classifyProfileUrl("https://www.instagram.com/usaa/")).toMatchObject({ platform: "instagram", handle: "usaa" });
    expect(classifyProfileUrl("https://www.tiktok.com/@veteransunited")).toMatchObject({ platform: "tiktok", handle: "veteransunited" });
    expect(classifyProfileUrl("https://www.linkedin.com/company/nbkc-bank/")).toMatchObject({ platform: "linkedin", handle: "nbkc-bank" });
    expect(classifyProfileUrl("https://www.youtube.com/user/VeteransUnited")).toMatchObject({ platform: "youtube", handle: "VeteransUnited" });
    expect(classifyProfileUrl("https://x.com/USAA")).toMatchObject({ platform: "x", handle: "USAA" });
  });

  it("returns nothing for a bare handle, so it is taken as typed", () => {
    expect(classifyProfileUrl("usaa")).toBeNull();
    expect(classifyProfileUrl("@usaa")).toBeNull();
  });

  it("returns nothing for a link that is not a social profile", () => {
    expect(classifyProfileUrl("https://www.usaa.com/about")).toBeNull();
  });
});
