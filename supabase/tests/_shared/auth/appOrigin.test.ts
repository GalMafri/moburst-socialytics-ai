// @vitest-environment node
// A third-party sign-in returns to the address the person started it from, as
// long as it is one of the app's own; anything else gets the default.
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_ORIGIN, defaultAppOrigin, returnOriginFor, settingsUrl } from "../../../functions/_shared/auth/appOrigin";

describe("where a sign-in returns to", () => {
  it("returns to the app address the sign-in was started from", () => {
    expect(returnOriginFor("https://socialytics.moburst.ai")).toBe("https://socialytics.moburst.ai");
    expect(returnOriginFor("https://socialytics.moburst.com")).toBe("https://socialytics.moburst.com");
    expect(returnOriginFor("https://moburst-socialytics-ai.lovable.app")).toBe("https://moburst-socialytics-ai.lovable.app");
  });

  it("falls back to the default for an address that is not the app's, or none", () => {
    for (const origin of ["https://evil.example", "https://socialytics.moburst.ai.evil.example", "http://socialytics.moburst.ai", "javascript:alert(1)", "not a url", "", null, undefined]) {
      expect(returnOriginFor(origin as string | null | undefined), String(origin)).toBe(DEFAULT_APP_ORIGIN);
    }
  });

  it("uses the APP_ORIGIN setting as the default and also accepts it", () => {
    const env = (k: string) => (k === "APP_ORIGIN" ? "https://staging.socialytics.test" : undefined);
    expect(defaultAppOrigin(env)).toBe("https://staging.socialytics.test");
    expect(returnOriginFor("https://evil.example", env)).toBe("https://staging.socialytics.test");
    expect(returnOriginFor("https://staging.socialytics.test", env)).toBe("https://staging.socialytics.test");
  });

  it("builds the settings address on the return origin, with only the outcome words", () => {
    expect(settingsUrl("https://socialytics.moburst.ai", { google: "not_connected", reason: "refused" })).toBe("https://socialytics.moburst.ai/settings?google=not_connected&reason=refused");
    expect(settingsUrl("https://evil.example", { higgsfield: "linked", reason: undefined })).toBe(`${DEFAULT_APP_ORIGIN}/settings?higgsfield=linked`);
  });
});
