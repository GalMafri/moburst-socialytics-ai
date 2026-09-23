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

describe('pasted profile validation', () => {
  it.each(['https://notinstagram.com/acme','https://instagram.com.evil.example/acme','https://examplex.com/acme','https://instagram.com/popular/','https://instagram.com/p/abc','https://facebook.com/profile.php','https://linkedin.com/jobs/','https://instagram.com/%ZZ'])('rejects %s without throwing', url => {
    expect(() => classifyProfileUrl(url)).not.toThrow();
    expect(classifyProfileUrl(url)).toBeNull();
  });
  it('preserves an explicit numeric Facebook profile ID', () => {
    expect(classifyProfileUrl('https://www.facebook.com/profile.php?id=123456789')).toMatchObject({platform:'facebook',handle:'123456789'});
  });
});
