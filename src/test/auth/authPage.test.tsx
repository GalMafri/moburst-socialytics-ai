import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const f = vi.hoisted(() => ({
  auth: { isLoading: false, isAuthenticated: false, authError: null as string | null },
  session: false as boolean,
  sessionError: null as unknown,
  roles: [] as Array<{ role: string }>,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => f.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => (f.sessionError ? { data: { session: null }, error: f.sessionError } : { data: { session: f.session ? { user: { id: "u" } } : null }, error: null }) },
  from: () => ({ select: () => ({ eq: async () => ({ data: f.roles, error: null }) }) }),
} }));

import Auth from "@/pages/Auth";
import { AUTH_ERROR_CODES, authMessage } from "@/lib/authMessages";

async function open(search = "") {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<MemoryRouter initialEntries={[`/auth${search}`]}><Auth /></MemoryRouter>); });
  return view;
}
const pageText = () => document.body.textContent || "";
const FORBIDDEN = /\brole|\bsession|reload|portal admin|this tool|bridge|hub auth|supabase|openai|claude|higgsfield|apify|rivaliq|sprout|duplicate key/i;

beforeEach(() => { f.auth = { isLoading: false, isAuthenticated: false, authError: null }; f.session = false; f.sessionError = null; f.roles = []; window.localStorage.clear(); });
afterEach(cleanup);

describe("the sign-in page", () => {
  it("shows one fixed sentence for a failed sign-in and none of the raw text", async () => {
    f.auth.authError = "Could not assign your role (duplicate key value violates unique constraint)";
    await open();
    expect(await screen.findByText(authMessage("internal"))).toBeInTheDocument();
    expect(pageText()).not.toMatch(FORBIDDEN);
  });

  it("never shows a developer word, a role, a session or a reload step in any state", async () => {
    const states: Array<() => void> = [
      () => { f.session = false; },
      () => { f.session = true; f.roles = []; },
      () => { f.session = true; f.roles = [{ role: "client" }]; },
      ...AUTH_ERROR_CODES.map((c) => () => { f.auth.authError = c; }),
    ];
    for (const set of states) {
      f.auth = { isLoading: false, isAuthenticated: false, authError: null }; f.session = false; f.sessionError = null; f.roles = [];
      set();
      const view = await open();
      await waitFor(() => expect(screen.getByRole("link", { name: "Open the Moburst portal" })).toBeInTheDocument());
      await new Promise((r) => setTimeout(r, 0));
      expect(pageText()).not.toMatch(FORBIDDEN);
      view.unmount();
    }
  });

  it("names each reason in a plain sentence of its own", () => {
    const sentences = AUTH_ERROR_CODES.map((c) => authMessage(c));
    for (const s of sentences) { expect(s).toMatch(/\.$/); expect(s).not.toMatch(FORBIDDEN); }
    expect(authMessage("no_access")).not.toBe(authMessage("deactivated"));
    expect(authMessage("something the page never heard of")).toBe(authMessage("internal"));
  });

  it("describes trends as the weekly themes, not as TikTok and Instagram", async () => {
    await open();
    expect(screen.getByText("Trends")).toBeInTheDocument();
    expect(screen.getByText("Each week's industry themes on the platforms the client posts on.")).toBeInTheDocument();
    expect(pageText()).not.toMatch(/TikTok|Instagram|Trend analysis/);
  });

  it("says why a moburst.ai handoff failed when the address carries the reason", async () => {
    await open("?reason=no_access");
    expect(await screen.findByText(authMessage("no_access"))).toBeInTheDocument();
  });

  it("ignores a reason in the address that is not on the list", async () => {
    await open("?reason=Could%20not%20assign%20your%20role");
    await new Promise((r) => setTimeout(r, 0));
    expect(pageText()).not.toMatch(/Could not assign/);
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });

  it("links to the portal the person last signed in from", async () => {
    window.localStorage.setItem("socialytics.lastPortal", "hub");
    await open();
    expect(screen.getByRole("link", { name: "Open the Moburst portal" })).toHaveAttribute("href", "https://tools.moburst.com");
  });

  it("links to the moburst.ai portal when none is recorded or moburst.ai was last", async () => {
    await open();
    // The portal's launch of Socialytics: sign in there, then straight back here (QA 23 Nov: the portal home left people there).
    expect(screen.getByRole("link", { name: "Open the Moburst portal" }).getAttribute("href")).toMatch(/^https:\/\/(moburst\.ai|mobtools\.ai)\/tool\/socialytics$/);
    cleanup();
    window.localStorage.setItem("socialytics.lastPortal", "gos");
    await open();
    expect(screen.getByRole("link", { name: "Open the Moburst portal" }).getAttribute("href")).not.toContain("tools.moburst.com");
  });

  it("says it could not reach the service, not that the sign-in is gone, when the auth server does not answer", async () => {
    f.sessionError = Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 });
    await open();
    expect(await screen.findByText(authMessage("unreachable"))).toBeInTheDocument();
  });
});

describe("portal links", () => {
  it("come from one helper: no file but gosAuth.ts reads PORTAL_URL", () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !path.endsWith(join("utils", "gosAuth.ts"))) {
          if (/\bPORTAL_URL\b/.test(readFileSync(path, "utf8"))) offenders.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it("follow the portal the page signed in from even when storage is blocked", async () => {
    vi.resetModules();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      const { rememberPortal, portalUrl, LEGACY_PORTAL_URL } = await import("@/utils/gosAuth");
      rememberPortal("hub");
      expect(portalUrl()).toBe(LEGACY_PORTAL_URL);
    } finally {
      spy.mockRestore(); getSpy.mockRestore();
    }
  });
});
