// /logout ends the session on this device, whether or not the sign-out
// request reaches the server. QA 22 Nov 2026 (P20-5): auth-js keeps the stored
// session when a global sign-out's revoke call fails (network, 5xx), and the
// next visit rebuilt the person from it.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({ session: null as null | { access_token: string }, calls: [] as string[], revoke: "fail" as "fail" | "ok" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      // As auth-js _signOut: the session goes when the revoke succeeds, or with scope "local"; a failed revoke returns the error and keeps it.
      signOut: async (opts: { scope?: string } = {}) => {
        const scope = opts.scope ?? "global";
        auth.calls.push(scope);
        if (scope === "local" || auth.revoke === "ok") { auth.session = null; return { error: null }; }
        return { error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } };
      },
    },
  },
}));
import { Logout } from "@/pages/GosPortal";

const replace = vi.fn();
beforeEach(() => {
  auth.session = { access_token: "token" };
  auth.calls = [];
  replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("leaves no stored session behind when the sign-out request does not get through, then leaves for the portal", async () => {
  auth.revoke = "fail";
  render(<Logout />);
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(auth.session).toBeNull();
  expect(auth.calls).toEqual(["global", "local"]);
});

it("signs out once when the request gets through", async () => {
  auth.revoke = "ok";
  render(<Logout />);
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(auth.session).toBeNull();
  expect(auth.calls).toEqual(["global"]);
});
