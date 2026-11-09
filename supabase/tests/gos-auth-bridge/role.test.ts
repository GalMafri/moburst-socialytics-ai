// @vitest-environment node
// The moburst.ai Hub (gOS) role a person signs in with, as a Socialytics role.
// 9 Nov 2026: six Moburst people with company assignments (Liran Gal among
// them) landed as clients and could not make designs. Lital: "make any @moburst
// email address automatically be granted a moburst user role, not client in
// both hubs".
import { describe, expect, it } from "vitest";
import { mapGosRole } from "../../functions/gos-auth-bridge/role.ts";

describe("mapGosRole", () => {
  it("makes admins and account managers admins, whatever their address", () => {
    for (const role of ["super_admin", "admin", "account_manager", " Admin "]) {
      expect(mapGosRole(role, "someone@gmail.com")).toBe("admin");
      expect(mapGosRole(role, "nimrod@moburst.com")).toBe("admin");
    }
  });

  it("makes anyone else with a moburst.com address a Moburst user, whatever role the Hub sends", () => {
    for (const role of ["user", "staff", "moburst_user", "client", "viewer", "owner", ""]) {
      expect(mapGosRole(role, "liran.gal@moburst.com")).toBe("moburst_user");
    }
    expect(mapGosRole("client", "Someone@Moburst.COM")).toBe("moburst_user");
  });

  it("makes everyone else a client, or refuses a role it does not know", () => {
    for (const role of ["user", "staff", "moburst_user", "client", "viewer"]) expect(mapGosRole(role, "owner@baderlaw.com")).toBe("client");
    expect(mapGosRole("user", "someone@notmoburst.com")).toBe("client");
    expect(mapGosRole("user", "moburst.com@gmail.com")).toBe("client");
    expect(mapGosRole("owner", "owner@baderlaw.com")).toBeNull();
    expect(mapGosRole("", "owner@baderlaw.com")).toBeNull();
  });
});
