// A sign-in with another service opens in its own tab (src/lib/signInTab.ts):
// Socialytics runs inside the Moburst Hub's frame, and Google refuses its
// sign-in page in a frame ("400. That's an error", 8 Nov 2026). The tab is
// opened on the click, before the link exists, so the browser allows it.
import { describe, expect, it, vi } from "vitest";
import { openSignIn, type SignInWindow } from "@/lib/signInTab";

const LINK = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";

function fakeWindow(opens: boolean) {
  const tab = { opener: {} as unknown, location: { href: "about:blank" }, close: vi.fn() };
  const win = { open: vi.fn(() => (opens ? tab : null)), location: { href: "https://socialytics.moburst.com/settings" } };
  return { tab, win: win as unknown as SignInWindow };
}

describe("openSignIn", () => {
  it("opens the tab before the link is ready, then points it at the sign-in", async () => {
    const { tab, win } = fakeWindow(true);
    let release!: (url: string) => void;
    const pending = openSignIn(() => new Promise<string>((r) => { release = r; }), win);
    expect(win.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("about:blank");
    release(LINK);
    expect(await pending).toBe(true);
    expect(tab.location.href).toBe(LINK);
    expect(tab.opener).toBeNull();
    expect(win.location.href).toBe("https://socialytics.moburst.com/settings");
  });

  it("closes the tab again when there is no link, or the link could not be made", async () => {
    const none = fakeWindow(true);
    expect(await openSignIn(async () => null, none.win)).toBe(false);
    expect(none.tab.close).toHaveBeenCalledTimes(1);
    const failed = fakeWindow(true);
    expect(await openSignIn(async () => { throw new Error("offline"); }, failed.win)).toBe(false);
    expect(failed.tab.close).toHaveBeenCalledTimes(1);
  });

  it("goes to the sign-in in this window when no tab could open", async () => {
    const { win } = fakeWindow(false);
    expect(await openSignIn(async () => LINK, win)).toBe(true);
    expect(win.location.href).toBe(LINK);
  });
});
