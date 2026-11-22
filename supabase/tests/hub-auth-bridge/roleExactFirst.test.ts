// @vitest-environment node
// P57-04: the Hub's Socialytics tool entry is the FIRST entry whose name starts
// with "socialytics", not the exact one. A person whose Hub lists another
// Socialytics-named tool before "Socialytics" gets that other tool's role.
import { describe, expect, it } from "vitest";
import { resolveToolRole, type HubUser } from "../../../supabase/functions/hub-auth-bridge/role.ts";

const person = (tools: HubUser["tools"]): HubUser => ({ _id: "1", name: "P", email: "owner@example.org", role: "user", company: "Acme", isActive: true, tools });

describe("hub-auth-bridge tool entry", () => {
  it("uses the exact Socialytics entry when a prefixed sibling is listed first", () => {
    const r = resolveToolRole(person([
      { tool: { _id: "a", name: "Socialytics Reports" }, role: "Client" },
      { tool: { _id: "b", name: "Socialytics" }, role: "Admin" },
    ]));
    expect(r.tool_entry_name).toBe("Socialytics");
    expect(r.role).toBe("admin");
  });
});
