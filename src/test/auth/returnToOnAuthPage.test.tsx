// QA 22 Nov 2026 (P10-02): ReturnTo is meant to finish a deep link when sign-in settles on "/" or "/auth". On /auth the
// sign-in page itself renders <Navigate to="/"/> once authenticated. Both effects run in the same commit;
// ReturnTo's (an earlier sibling) runs first, then Navigate's sends the person to "/", where the stored
// path has already been consumed. The deep link is lost.
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

let setAuth: (a: { isAuthenticated: boolean; isLoading: boolean }) => void = () => {};
let auth = { isAuthenticated: false, isLoading: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...auth, authError: null }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));

import Auth from "@/pages/Auth";
import { ReturnTo } from "@/components/ReturnTo";
import { rememberReturnTo } from "@/utils/returnTo";

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; }
function Shell() {
  const [, force] = useState(0);
  setAuth = (a) => { auth = { ...auth, ...a }; force((n) => n + 1); };
  return (
    <>
      <ReturnTo />
      <Where />
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<p>Dashboard</p>} />
        <Route path="/clients/:id/calendar" element={<p>Calendar</p>} />
      </Routes>
    </>
  );
}

describe("P10-02 deep link when sign-in settles on /auth", () => {
  it("goes on to the stored page", async () => {
    localStorage.clear();
    // A guard stored this before sending the person to /auth (RedirectToSignIn).
    rememberReturnTo("/clients/c1/calendar?week=2026-11-16");
    render(<MemoryRouter initialEntries={["/auth"]}><Shell /></MemoryRouter>);
    await act(async () => { setAuth({ isAuthenticated: true, isLoading: false }); });
    expect(screen.getByTestId("where").textContent).toBe("/clients/c1/calendar");
  });
});
