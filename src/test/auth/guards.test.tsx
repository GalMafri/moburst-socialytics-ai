import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

const f = vi.hoisted(() => ({
  auth: { isLoading: true, isAuthenticated: false, isAdmin: false, isMoburstStaff: false, user: null as null | { name: string } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => f.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/layout/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/utils/gosAuth", () => ({ portalUrl: () => "https://portal.example", getGosHandoffToken: () => "t" }));

import { AdminOnlyRoute } from "@/components/AdminOnlyRoute";
import { StaffOnlyRoute } from "@/components/StaffOnlyRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import AuthHandoff from "@/pages/AuthHandoff";
import { consumeReturnTo, rememberReturnTo } from "@/utils/returnTo";
import { initHubToken } from "@/utils/hubAuth";

function at(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<div>Sign-in page</div>} />
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  f.auth = { isLoading: true, isAuthenticated: false, isAdmin: false, isMoburstStaff: false, user: null };
});
afterEach(cleanup);

describe("the loading screen while sign-in is checked", () => {
  for (const [name, el] of [
    ["StaffOnlyRoute", <StaffOnlyRoute><p>Inside</p></StaffOnlyRoute>],
    ["AdminOnlyRoute", <AdminOnlyRoute><p>Inside</p></AdminOnlyRoute>],
    ["AuthHandoff", <AuthHandoff />],
    ["AppLayout", <AppLayout><p>Inside</p></AppLayout>],
  ] as const) {
    it(`${name} is one status that says Signing you in`, () => {
      at("/x", el);
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("Signing you in");
      expect(screen.queryByText("Loading...")).toBeNull();
    });
  }
});

describe("a deep link opened signed out", () => {
  it("is remembered by AppLayout, then the person goes to sign in", async () => {
    f.auth.isLoading = false;
    at("/clients/c1/reports", <AppLayout><p>Inside</p></AppLayout>);
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(consumeReturnTo()).toBe("/clients/c1/reports");
  });

  it("is remembered by both guards", async () => {
    f.auth.isLoading = false;
    at("/admin/usage", <AdminOnlyRoute><p>Inside</p></AdminOnlyRoute>);
    await screen.findByText("Sign-in page");
    expect(consumeReturnTo()).toBe("/admin/usage");
    cleanup();
    at("/clients/c2", <StaffOnlyRoute><p>Inside</p></StaffOnlyRoute>);
    await screen.findByText("Sign-in page");
    expect(consumeReturnTo()).toBe("/clients/c2");
  });

  it("does not remember a page the person is only passing through", async () => {
    f.auth = { ...f.auth, isLoading: false, isAuthenticated: true, isAdmin: false, isMoburstStaff: false };
    at("/admin/usage", <AdminOnlyRoute><p>Inside</p></AdminOnlyRoute>);
    await waitFor(() => expect(screen.queryByText("Inside")).toBeNull());
    expect(consumeReturnTo()).toBeNull();
  });
});

// A legacy portal opens the tool at /?hubToken=<JWT>. AuthProvider strips the
// token from the address with history.replaceState, which the router does not
// see, so the router still reports the old query. Nothing that is stored for
// later may carry the token, and the landing page must not replace a deep link
// stored a moment earlier.
describe("a portal landing with a sign-in token that ends signed out", () => {
  function inBrowser(path: string, element: () => React.ReactNode) {
    window.history.pushState({}, "", path);
    const ui = () => (
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<div>Sign-in page</div>} />
          <Route path="*" element={element()} />
        </Routes>
      </BrowserRouter>
    );
    const view = render(ui());
    initHubToken();
    f.auth = { ...f.auth, isLoading: false, isAuthenticated: false };
    view.rerender(ui());
    return view;
  }

  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("keeps the token out of storage and keeps the deep link stored before it", async () => {
    rememberReturnTo("/usage");
    inBrowser("/?hubToken=abc", () => <AppLayout><p>Inside</p></AppLayout>);
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(localStorage.getItem("mb_return_to") ?? "").not.toContain("hubToken");
    expect(consumeReturnTo()).toBe("/usage");
  });

  it("stores a guarded page opened with a token without the token", async () => {
    inBrowser("/settings?hubToken=abc", () => <AdminOnlyRoute><p>Inside</p></AdminOnlyRoute>);
    await screen.findByText("Sign-in page");
    expect(localStorage.getItem("mb_return_to") ?? "").not.toContain("hubToken");
    expect(consumeReturnTo()).toBe("/settings");
  });
});
