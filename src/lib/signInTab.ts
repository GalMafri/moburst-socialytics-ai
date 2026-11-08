// src/lib/signInTab.ts
//
// A sign-in with another service (Google for strategy decks, Higgsfield for
// generation) opens in its own tab. Socialytics runs inside the Moburst Hub's
// frame (tools.moburst.com), and sign-in pages refuse to load in a frame:
// Google answers with its "400. That's an error" page (8 Nov 2026). The tab
// opens on the click, while the browser still allows a new tab, and is
// pointed at the sign-in once the app has the link. The service sends that
// tab back to /settings, which shows the result; the panel in this tab
// checks again when the person comes back to it.

/** The parts of a browser window this needs. */
export interface SignInWindow {
  open(url: string, target: string): { opener: unknown; location: { href: string }; close(): void } | null;
  location: { href: string };
}

/** Opens the sign-in in a new tab; false when there was no link to open. */
export async function openSignIn(link: () => Promise<string | null>, win: SignInWindow = window as unknown as SignInWindow): Promise<boolean> {
  const tab = win.open("", "_blank");
  const url = await link().catch((e) => {
    console.warn("[sign-in] no link yet", e);
    return null;
  });
  if (!url) {
    tab?.close();
    return false;
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = url;
  } else {
    // No tab could open: outside the Hub's frame the sign-in works in this window.
    win.location.href = url;
  }
  return true;
}
