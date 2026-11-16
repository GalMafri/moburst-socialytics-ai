/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";

const f = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("@/components/dashboard/ClientOverview", () => ({ ClientOverview: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canManageClients: true, canRunAnalysis: true, canDelete: true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: vi.fn(),
  from: () => ({ select: () => ({ order: async () => ({ data: f.clients, error: null }) }) }),
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://files.test/${p}` } }) }) },
} }));
afterEach(() => cleanup());

it("a client's card shows every platform it is set up for, not the first three", async () => {
  f.clients = [{ id: "a", name: "Adaptive", reports: [], archived_at: null, primary_platforms: ["instagram", "linkedin", "tiktok", "facebook", "youtube"] }];
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AdminDashboard /></MemoryRouter></QueryClientProvider>);
  await screen.findByRole("button", { name: "Open Adaptive client setup" });
  for (const name of ["Instagram", "LinkedIn", "TikTok", "Facebook", "YouTube"]) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
});
