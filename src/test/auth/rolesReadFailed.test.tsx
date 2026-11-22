/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P17: the sign-in page tells a stored session apart from no sign-in by reading user_roles.
// Hypothesis: when that read fails (no answer), its error is ignored and `roles` is null, so
// the page says the account has no access, a claim made on a read that never answered.
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Auth from "@/pages/Auth";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: false, isLoading: false, authError: null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }) },
  from: () => {
    const q: any = { select: () => q, eq: () => q, then: (ok: any, fail: any) => Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch", code: "" } }).then(ok, fail) };
    return q;
  },
} }));
afterEach(() => cleanup());

it("a roles read that did not answer is not told as 'no access'", async () => {
  render(<MemoryRouter initialEntries={["/auth"]}><Auth /></MemoryRouter>);
  expect(await screen.findByText("Sign-in did not finish")).toBeInTheDocument();
  expect(screen.queryByText(/does not have access to Socialytics/)).toBeNull();
});
