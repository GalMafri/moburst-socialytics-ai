// @vitest-environment node
// The Hub (gOS) role a person signs in with, as a Socialytics role.
// 9 Nov 2026: six Moburst people with company assignments (Liran Gal among
// them) landed as clients and could not make designs; a Moburst user limited
// to their companies (20260720130000_company_scoped_staff.sql) is what they are.
import { describe, expect, it } from "vitest";
import { mapGosRole } from "../../functions/gos-auth-bridge/role.ts";

describe("mapGosRole", () => {
  it("makes admins and account managers admins", () => {
    for (const role of ["super_admin", "admin", "account_manager", " Admin "]) expect(mapGosRole(role, null)).toBe("admin");
  });

  it("makes a Moburst user with companies a Moburst user, limited to them by the database", () => {
    expect(mapGosRole("user", null)).toBe("moburst_user");
    expect(mapGosRole("staff", null)).toBe("moburst_user");
    expect(mapGosRole("user", "Moburst")).toBe("moburst_user");
    expect(mapGosRole("user", "moburst.com")).toBe("moburst_user");
    expect(mapGosRole("user", "  ")).toBe("moburst_user");
  });

  it("keeps a Moburst user with no company a Moburst user", () => {
    expect(mapGosRole("user", null)).toBe("moburst_user");
    expect(mapGosRole("moburst_user", null)).toBe("moburst_user");
  });

  it("keeps anyone the Hub places in an outside organization a client", () => {
    expect(mapGosRole("user", "Bader Law")).toBe("client");
    expect(mapGosRole("staff", "Bader Law")).toBe("client");
    expect(mapGosRole("user", "Bader Law")).toBe("client");
  });

  it("keeps Hub clients and viewers clients", () => {
    expect(mapGosRole("client", null)).toBe("client");
    expect(mapGosRole("viewer", "Moburst")).toBe("client");
  });

  it("refuses a role it does not know", () => {
    expect(mapGosRole("owner", null)).toBeNull();
    expect(mapGosRole("", null)).toBeNull();
  });
});
