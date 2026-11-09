// @vitest-environment node
// The Hub (gOS) role a person signs in with, as a Socialytics role.
// 9 Nov 2026: six Moburst people with company assignments (Liran Gal among
// them) landed as clients and could not make designs. A Moburst person is a
// Moburst user, who sees every client (20261111110000), so the test that
// makes someone a Moburst user must never let an outside person through.
import { describe, expect, it } from "vitest";
import { mapGosRole } from "../../functions/gos-auth-bridge/role.ts";

describe("mapGosRole", () => {
  it("makes admins and account managers admins", () => {
    for (const role of ["super_admin", "admin", "account_manager", " Admin "]) expect(mapGosRole(role, "someone@gmail.com", null)).toBe("admin");
  });

  it("makes a Hub user or staff member with a moburst.com address a Moburst user", () => {
    expect(mapGosRole("user", "liran.gal@moburst.com", null)).toBe("moburst_user");
    expect(mapGosRole("staff", "core@moburst.com", null)).toBe("moburst_user");
    expect(mapGosRole("moburst_user", "Someone@Moburst.COM", null)).toBe("moburst_user");
    expect(mapGosRole("user", "lital+test@moburst.com", "Moburst")).toBe("moburst_user");
    expect(mapGosRole("user", "manol.c@moburst.com", "moburst.com")).toBe("moburst_user");
  });

  it("keeps anyone without a moburst.com address a client, whatever organization the Hub sends", () => {
    expect(mapGosRole("user", "owner@baderlaw.com", null)).toBe("client");
    expect(mapGosRole("user", "someone@gmail.com", "Moburst")).toBe("client");
    expect(mapGosRole("user", "someone@notmoburst.com", null)).toBe("client");
    expect(mapGosRole("user", "someone@moburst.com.evil.io", null)).toBe("client");
    expect(mapGosRole("user", "moburst.com@gmail.com", null)).toBe("client");
    expect(mapGosRole("staff", "", null)).toBe("client");
  });

  it("lets an outside organization only demote, never grant", () => {
    expect(mapGosRole("user", "someone@moburst.com", "Bader Law")).toBe("client");
    expect(mapGosRole("user", "someone@moburst.com", "Bader Law (via Moburst)")).toBe("client");
  });

  it("keeps Hub clients and viewers clients", () => {
    expect(mapGosRole("client", "someone@moburst.com", null)).toBe("client");
    expect(mapGosRole("viewer", "someone@moburst.com", "Moburst")).toBe("client");
  });

  it("refuses a role it does not know", () => {
    expect(mapGosRole("owner", "someone@moburst.com", null)).toBeNull();
    expect(mapGosRole("", "someone@moburst.com", null)).toBeNull();
  });
});
