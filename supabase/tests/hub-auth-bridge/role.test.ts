// @vitest-environment node
// The tools.moburst.com Hub role a person signs in with, as a Socialytics role.
// The Hub's Socialytics tool entry decides, as before, except that any
// moburst.com address is at least a Moburst user (Lital, 9 Nov 2026: "make any
// @moburst email address automatically be granted a moburst user role, not
// client in both hubs"). lior@moburst.com had landed as a client this way.
import { describe, expect, it } from "vitest";
import { resolveToolRole, type HubUser } from "../../functions/hub-auth-bridge/role.ts";

const person = (over: Partial<HubUser>): HubUser => ({ _id: "1", name: "P", email: "owner@baderlaw.com", role: "user", company: "", isActive: true, tools: [], ...over });
const entry = (role: string, name = "Socialytics") => [{ tool: { _id: "t", name }, role }];

describe("resolveToolRole", () => {
  it("reads the Socialytics tool entry as before for an outside address", () => {
    expect(resolveToolRole(person({ tools: entry("Admin") })).role).toBe("admin");
    expect(resolveToolRole(person({ tools: entry("Moburst User") })).role).toBe("moburst_user");
    expect(resolveToolRole(person({ tools: entry("Client") })).role).toBe("client");
    expect(resolveToolRole(person({ tools: entry("Viewer", "Socialytics AI") })).role).toBe("client");
    expect(resolveToolRole(person({ tools: entry("something else") })).role).toBeNull();
  });

  it("falls back to the global admin role, and refuses anyone else with no entry, for an outside address", () => {
    expect(resolveToolRole(person({ role: "admin" })).role).toBe("admin");
    const none = resolveToolRole(person({}));
    expect(none.role).toBeNull();
    expect(none.source).toBe("none");
  });

  it("makes any moburst.com address at least a Moburst user, with or without a tool entry", () => {
    const lior = resolveToolRole(person({ email: "lior@moburst.com", tools: entry("Client") }));
    expect(lior.role).toBe("moburst_user");
    expect(lior.source).toBe("moburst_address");
    expect(resolveToolRole(person({ email: "gal@moburst.com" })).role).toBe("moburst_user");
    expect(resolveToolRole(person({ email: "gal@moburst.com", tools: entry("something else") })).role).toBe("moburst_user");
    expect(resolveToolRole(person({ email: "gal@moburst.com", company: "Bader Law", tools: entry("Viewer") })).role).toBe("moburst_user");
  });

  it("keeps a moburst.com admin an admin", () => {
    expect(resolveToolRole(person({ email: "nimrod@moburst.com", tools: entry("Admin") })).role).toBe("admin");
    expect(resolveToolRole(person({ email: "nimrod@moburst.com", role: "admin" })).role).toBe("admin");
  });
});
