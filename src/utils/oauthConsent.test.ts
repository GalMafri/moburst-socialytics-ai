import { describe, expect, it } from "vitest";
import { CLAUDE_CALLBACK, consentEntry, consentStep, CONSENT_ORIGIN, isAuthorizationId } from "./oauthConsent";

// The shape Supabase Auth uses: 32 characters of lowercase base32.
const ID = "k7q2m4n6p3r5t7v2x4z6b3d5f7h2j4l6";

describe("isAuthorizationId", () => {
  it("accepts the ids Supabase Auth makes and nothing else", () => {
    expect(isAuthorizationId(ID)).toBe(true);
    for (const bad of [null, undefined, "", ID.slice(1), `${ID}a`, ID.toUpperCase(), "k7q2m4n6p3r5t7v2x4z6b3d5f7h2j4l1", "k7q2m4n6p3r5t7v2x4z6b3d5f7h2j4l&", "../../auth?x=1aaaaaaaaaaaaaaaaaaaaa"]) expect(isAuthorizationId(bad), String(bad)).toBe(false);
  });
});

describe("consentEntry", () => {
  it("forwards any other origin to socialytics.moburst.ai with only the authorization id", () => {
    expect(CONSENT_ORIGIN).toBe("https://socialytics.moburst.ai");
    expect(consentEntry("https://moburst-socialytics-ai.lovable.app", `?authorization_id=${ID}`)).toEqual({ kind: "forward", url: `https://socialytics.moburst.ai/oauth/consent?authorization_id=${ID}` });
    expect(consentEntry("https://socialytics.moburst.com", `?authorization_id=${ID}&next=https://evil.example&x=1`)).toEqual({ kind: "forward", url: `https://socialytics.moburst.ai/oauth/consent?authorization_id=${ID}` });
  });

  it("runs the consent on socialytics.moburst.ai", () => {
    expect(consentEntry("https://socialytics.moburst.ai", `?authorization_id=${ID}`)).toEqual({ kind: "here", authorizationId: ID });
  });

  it("never forwards or runs anything that is not an authorization id", () => {
    for (const search of ["", "?authorization_id=", "?authorization_id=abc", `?authorization_id=${ID}%26next%3D%2F%2Fevil`, `?authorization_id=${encodeURIComponent("//evil.example/")}`]) {
      expect(consentEntry("https://moburst-socialytics-ai.lovable.app", search), search).toEqual({ kind: "invalid" });
      expect(consentEntry("https://socialytics.moburst.ai", search), search).toEqual({ kind: "invalid" });
    }
  });
});

describe("consentStep", () => {
  const details = (redirect_uri: string) => ({ authorization_id: ID, redirect_uri, client: { id: "c", name: "Claude", uri: "", logo_uri: "" }, user: { id: "u", email: "sinead@moburst.com" }, scope: "openid email profile" });

  it("asks the person when the request is Claude's, showing where they go back to and who they are", () => {
    expect(CLAUDE_CALLBACK).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(consentStep(details("https://claude.ai/api/mcp/auth_callback"))).toEqual({ kind: "ask", host: "claude.ai", email: "sinead@moburst.com" });
  });

  it("refuses any other redirect, Claude Code's loopback and look-alikes included", () => {
    for (const uri of ["http://localhost:53682/callback", "https://claude.ai/api/mcp/auth_callback/", "https://claude.ai.evil.example/api/mcp/auth_callback", "https://evil.example/?r=https://claude.ai/api/mcp/auth_callback", "http://claude.ai/api/mcp/auth_callback", "not a url"]) {
      expect(consentStep(details(uri)), uri).toEqual({ kind: "refuse" });
    }
  });

  it("goes straight back to Claude when the person already allowed it, and nowhere else", () => {
    expect(consentStep({ redirect_url: "https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz" })).toEqual({ kind: "go", url: "https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz" });
    expect(consentStep({ redirect_url: "https://evil.example/cb?code=abc" })).toEqual({ kind: "refuse" });
  });
});
