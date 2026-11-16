import { describe, it, expect, beforeEach } from "vitest";
import { rememberReturnTo, consumeReturnTo } from "./returnTo";

describe("returnTo", () => {
  beforeEach(() => localStorage.clear());

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

  // A portal may open the tool in a new tab. sessionStorage does not cross
  // tabs, localStorage does, which is why this is not stored per-tab.
  it("survives a new tab", () => {
    rememberReturnTo("/admin/usage");
    expect(localStorage.getItem("mb_return_to")).toContain("/admin/usage");
    expect(consumeReturnTo()).toBe("/admin/usage");
  });

  // localStorage outlives the trip, so a path must not linger and hijack an
  // unrelated visit days later.
  it("ignores a path older than the TTL", () => {
    const t0 = 1_000_000;
    rememberReturnTo("/admin/usage", t0);
    expect(consumeReturnTo(t0 + 11 * 60 * 1000)).toBeNull();
  });

  it("honours a path inside the TTL", () => {
    const t0 = 1_000_000;
    rememberReturnTo("/admin/usage", t0);
    expect(consumeReturnTo(t0 + 60 * 1000)).toBe("/admin/usage");
  });

  it("survives corrupt storage without throwing", () => {
    localStorage.setItem("mb_return_to", "not json");
    expect(consumeReturnTo()).toBeNull();
  });

  // The security-relevant half: anything that could send a signed-in user
  // off-site must be refused, not stored and later navigated to.
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

  // Bouncing back to an auth route would loop the user straight out again.
  it.each(["/auth", "/auth/handoff?token=x", "/login", "/logout", "/portal"])(
    "refuses the auth route %s",
    (route) => {
      rememberReturnTo(route);
      expect(consumeReturnTo()).toBeNull();
    },
  );

  // Sign-in parameters are credentials. They are never kept for later, from
  // any caller, so the address bar never gets a used token back.
  it.each([
    ["/?hubToken=abc", null],
    ["/settings?hubToken=abc", "/settings"],
    ["/reports?client=bader-law&hubToken=abc", "/reports?client=bader-law"],
    ["/reports?token=abc&client=bader-law", "/reports?client=bader-law"],
  ])("drops sign-in parameters from %s", (path, stored) => {
    rememberReturnTo(path);
    expect(consumeReturnTo()).toBe(stored);
  });

  // The landing page is where the journey ends anyway, so it never replaces a
  // deep link stored a moment earlier.
  it("keeps a stored deep link when the landing page is remembered", () => {
    rememberReturnTo("/admin/usage");
    rememberReturnTo("/");
    expect(consumeReturnTo()).toBe("/admin/usage");
  });

  // A path with no sign-in parameter is stored byte for byte: rebuilding the
  // query would turn %20 into + and "?flag" into "?flag=".
  it.each(["/reports?q=a%20b", "/reports?flag", "/reports?q=a%20b&flag#top"])(
    "stores %s unchanged",
    (path) => {
      rememberReturnTo(path);
      expect(consumeReturnTo()).toBe(path);
    },
  );
});
