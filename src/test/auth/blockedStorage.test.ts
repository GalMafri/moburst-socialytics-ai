// QA 22 Nov 2026 (P10-03): with site storage blocked (browser set to block all cookies/site data), reading `localStorage`
// throws a SecurityError. client.ts calls brokeredPreviewStorage() at module load, and off a Lovable
// preview host it returns the bare `localStorage` global (previewAuthStorage.ts:58), so importing the
// Supabase client throws and the app never renders. Left undefined, supabase-js would fall back to memory.
import { afterEach, describe, expect, it } from "vitest";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import { clearHubToken, getHubToken, initHubToken } from "@/utils/hubAuth";

const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const realSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
afterEach(() => { if (real) Object.defineProperty(globalThis, "localStorage", real); if (realSession) Object.defineProperty(globalThis, "sessionStorage", realSession); });

describe("P10-03 storage blocked", () => {
  it("picks the auth storage without throwing on the production host", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Access is denied for this document.", "SecurityError"); },
    });
    expect(location.hostname).toBe("localhost"); // not a Lovable preview host
    expect(() => brokeredPreviewStorage()).not.toThrow();
    expect(brokeredPreviewStorage()).toBeUndefined();
  });

  it("keeps the Hub token for the page when sessionStorage is blocked", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() { throw new DOMException("Access is denied for this document.", "SecurityError"); },
    });
    window.history.replaceState({}, "", "/?hubToken=abc");
    expect(initHubToken()).toBe("abc");
    expect(getHubToken()).toBe("abc");
    clearHubToken();
    expect(getHubToken()).toBeNull();
  });
});
