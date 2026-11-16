import React, { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// An admin whom useAuth calls signed in, while the Supabase client answers the
// usage read with a refusal (42501). This is the preview case, where the dev
// admin has no Supabase session, and any moment the two disagree.
const f = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isLoading: false, isAuthenticated: true, isAdmin: true, isMoburstStaff: true,
    authError: null, user: { name: "Ada" },
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => f.rpc(fn, args),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/utils/gosAuth", () => ({ portalUrl: () => "https://portal.example", getGosHandoffToken: () => "t" }));

import { AdminOnlyRoute } from "@/components/AdminOnlyRoute";
import { ReturnTo } from "@/components/ReturnTo";
import Auth from "@/pages/Auth";
import Usage from "@/pages/Usage";

const visits: string[] = [];
function Track() {
  const { pathname } = useLocation();
  useEffect(() => { visits.push(pathname); }, [pathname]);
  return null;
}

beforeEach(() => {
  visits.length = 0;
  localStorage.clear();
  f.rpc.mockImplementation(async (fn: string) =>
    fn === "get_user_analytics"
      ? { data: null, error: { code: "42501", message: "permission denied for function get_user_analytics" } }
      : { data: [], error: null });
});
afterEach(cleanup);

describe("the Usage page behind the admin guard, when its read is refused", () => {
  it("stays on /usage and keeps loading, with no trip to sign-in and back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/usage"]}>
          <ReturnTo />
          <Track />
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={<div>Home</div>} />
            <Route path="/usage" element={<AdminOnlyRoute><Usage /></AdminOnlyRoute>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Let the read settle and any redirect run its course, then check that the
    // location no longer moves.
    const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    for (let i = 0; i < 20; i++) await tick();
    const settled = visits.length;
    for (let i = 0; i < 10; i++) await tick();

    expect(visits).toHaveLength(settled);
    expect(visits.filter((p) => p === "/auth").length).toBeLessThanOrEqual(1);
    expect(visits).not.toContain("/auth");
    expect(visits).toEqual(["/usage"]);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.queryByText("Home")).toBeNull();
    // The quiet retry still tells the team why, so a lasting refusal can be
    // diagnosed from the console.
    expect(warn).toHaveBeenCalledWith("[load retry]", "usage", expect.stringContaining("permission denied"));
  });
});
