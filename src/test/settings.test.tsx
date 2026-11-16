/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// Settings: each panel states what is true now. Google's sign-in return says
// what happened in words; the Sprout panel does not explain where its sign-in
// is kept.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const f = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => f.invoke(...a) } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: f.toast }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/HubCompanySync", () => ({ HubCompanySync: () => null }));
vi.mock("@/components/settings/HiggsfieldConnection", () => ({ HiggsfieldConnection: () => null }));
vi.mock("@/components/settings/ApiAccessCard", () => ({ ApiAccessCard: () => null }));
vi.mock("@/lib/activeClients", () => ({ fetchActiveClients: async () => [] }));

import Settings from "@/pages/Settings";

const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><Settings /></MemoryRouter></QueryClientProvider>);
};

beforeEach(() => {
  f.invoke.mockImplementation(async () => ({ data: { ready: true, connected: false, account_email: null, connected_at: null }, error: null }));
});
afterEach(() => { cleanup(); f.invoke.mockReset(); f.toast.mockReset(); });

describe("Settings", () => {
  it("says only that Sprout Social is connected, with no word on where its sign-in is kept", async () => {
    mount("/settings");
    expect(await screen.findByText(/Every client's figures come from Sprout Social\. Connected\./)).toBeTruthy();
    expect(screen.queryByText(/stored securely on the server/)).toBeNull();
  });

  it("shows why Google's sign-in did not connect, in words, when it comes back", async () => {
    mount("/settings?google=not_connected&reason=refused");
    expect(await screen.findByText("Google did not allow the sign-in.")).toBeTruthy();
    expect(f.toast).not.toHaveBeenCalled();
  });

  it("toasts a Google sign-in that connected", async () => {
    mount("/settings?google=connected");
    await screen.findByText("Google Slides");
    expect(f.toast).toHaveBeenCalledWith({ title: "Google Slides connected" });
  });
});
