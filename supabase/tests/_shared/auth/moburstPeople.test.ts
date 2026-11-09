// @vitest-environment node
// Lital, 9 Nov 2026: "make any @moburst email address automatically be granted
// a moburst user role, not client in both hubs".
import { describe, expect, it } from "vitest";
import { moburstAddress, withMoburstFloor } from "../../../functions/_shared/auth/moburstPeople.ts";

describe("moburstAddress", () => {
  it("is true only for an address exactly at moburst.com, any case", () => {
    for (const e of ["liran.gal@moburst.com", "Someone@Moburst.COM", " core@moburst.com "]) expect(moburstAddress(e)).toBe(true);
    for (const e of ["someone@notmoburst.com", "someone@moburst.com.evil.io", "moburst.com@gmail.com", "someone@mail.moburst.com", "moburst.com", "", null, undefined]) expect(moburstAddress(e)).toBe(false);
  });
});

describe("withMoburstFloor", () => {
  it("makes any moburst.com person at least a Moburst user, and keeps admins admins", () => {
    expect(withMoburstFloor("client", "lior@moburst.com")).toBe("moburst_user");
    expect(withMoburstFloor(null, "lior@moburst.com")).toBe("moburst_user");
    expect(withMoburstFloor("moburst_user", "lior@moburst.com")).toBe("moburst_user");
    expect(withMoburstFloor("admin", "nimrod@moburst.com")).toBe("admin");
  });

  it("leaves everyone else's role as the Hub gave it", () => {
    expect(withMoburstFloor("client", "owner@baderlaw.com")).toBe("client");
    expect(withMoburstFloor(null, "owner@baderlaw.com")).toBeNull();
    expect(withMoburstFloor("moburst_user", "freelancer@gmail.com")).toBe("moburst_user");
    expect(withMoburstFloor("admin", "someone@mobtools.ai")).toBe("admin");
  });
});
