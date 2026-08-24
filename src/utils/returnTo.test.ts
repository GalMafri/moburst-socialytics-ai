import { describe, it, expect, beforeEach } from "vitest";
import { rememberReturnTo, consumeReturnTo } from "./returnTo";

describe("returnTo", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips an in-app path", () => {
    rememberReturnTo("/admin/usage");
    expect(consumeReturnTo()).toBe("/admin/usage");
  });

  it("keeps a query string", () => {
    rememberReturnTo("/reports?client=bader-law");
    expect(consumeReturnTo()).toBe("/reports?client=bader-law");
  });

  it("clears after reading, so a stale path cannot fire twice", () => {
    rememberReturnTo("/admin/usage");
    consumeReturnTo();
    expect(consumeReturnTo()).toBeNull();
  });

  it("returns null when nothing was stored", () => {
    expect(consumeReturnTo()).toBeNull();
  });

  // The security-relevant half: anything that could send a signed-in user
  // somewhere off-site must be refused, not stored and later navigated to.
  it.each([
    ["protocol-relative", "//evil.example.com"],
    ["absolute http", "https://evil.example.com/steal"],
    ["backslash trick", "/\\evil.example.com"],
    ["embedded backslash", "/reports\\..\\admin"],
    ["not a path", "javascript:alert(1)"],
    ["empty", ""],
  ])("refuses %s", (_label, bad) => {
    rememberReturnTo(bad);
    expect(consumeReturnTo()).toBeNull();
  });

  // Bouncing back to an auth route would loop the user straight back out.
  it.each(["/auth", "/auth/handoff?token=x", "/login", "/logout", "/portal"])(
    "refuses the auth route %s",
    (route) => {
      rememberReturnTo(route);
      expect(consumeReturnTo()).toBeNull();
    },
  );
});
