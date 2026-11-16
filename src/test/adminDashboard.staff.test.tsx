/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";

const f = vi.hoisted(() => ({ clients: [] as any[], onReports: null as null | (() => void), selects: [] as string[] }));
vi.mock("@/components/dashboard/ClientOverview", () => ({ ClientOverview: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canManageClients: true, canRunAnalysis: true, canDelete: true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => ({ on: (_e: string, _o: unknown, cb: () => void) => { f.onReports = cb; return { subscribe: () => ({}) }; } }),
  removeChannel: vi.fn(),
  from: () => ({ select: (cols: string) => { f.selects.push(cols); return { order: async () => ({ data: f.clients, error: null }) }; } }),
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://files.test/${p}` } }) }) },
} }));

const done = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, status: "completed", created_at: "2020-01-01T00:00:00Z" }));
function mount(client = new QueryClient()) {
  return { client, ...render(<QueryClientProvider client={client}><MemoryRouter><AdminDashboard /></MemoryRouter></QueryClientProvider>) };
}
beforeEach(() => { f.clients = []; f.onReports = null; f.selects = []; });
afterEach(() => cleanup());

it("the report tiles count the active clients' reports only", async () => {
  f.clients = [
    { id: "a", name: "Active", reports: done(2), archived_at: null, primary_platforms: [] },
    { id: "z", name: "Archived", reports: done(3), archived_at: "2026-01-01", primary_platforms: [] },
  ];
  mount();
  const label = await screen.findByText("Completed reports");
  // The tile's figure is the element right after its label.
  expect(label.closest("p")!.nextElementSibling!.textContent).toBe("2");
});

it("a selected client without a logo shows its initials in the card header", async () => {
  f.clients = [{ id: "a", name: "Kitcaster", reports: [], archived_at: null, logo_url: null, primary_platforms: [] }];
  mount();
  await screen.findByRole("button", { name: "Open Kitcaster client setup" });
  expect(screen.getAllByText("KI").length).toBeGreaterThanOrEqual(2); // the picker row and the card header
});

it("the client query brings each client's chosen logo surface along", async () => {
  mount();
  await waitFor(() => expect(f.selects.length).toBeGreaterThan(0));
  expect(f.selects[0]).toContain("design_brand_settings(logo_path, background)");
});

it("uses one name per page and action", async () => {
  f.clients = [{ id: "a", name: "Alpha", reports: done(1), archived_at: null, primary_platforms: [] }];
  mount();
  await screen.findByRole("button", { name: "Open Alpha client setup" });
  for (const name of ["Client setup", "Run monthly report", "Run competitive analysis", "Monthly reports", "Competitive analyses", "Edit competitors"]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
  for (const old of ["Edit client", "Run competitive report", "Competitive reports", "Reports"]) {
    expect(screen.queryByRole("button", { name: old })).not.toBeInTheDocument();
  }
});

it("says what the staff dashboard needs in plain words: no configuration, no demo job", async () => {
  f.clients = [];
  const first = mount();
  const empty = await screen.findByText("Add your first client");
  const text = empty.closest("div")!.parentElement!.textContent ?? "";
  expect(text).not.toMatch(/configur/i);
  first.unmount();
  f.clients = [{ id: "d", name: "Demo Brand", reports: [], archived_at: null, demo_job_id: "j", primary_platforms: [] }];
  mount();
  const badge = await screen.findByText("Demo");
  expect(badge.getAttribute("title") ?? "").not.toMatch(/demo job/i);
});

it("a change to any report also refreshes every client's overview", async () => {
  f.clients = [{ id: "a", name: "Alpha", reports: [], archived_at: null, primary_platforms: [] }];
  const { client } = mount();
  await screen.findByRole("button", { name: "Open Alpha client setup" });
  const spy = vi.spyOn(client, "invalidateQueries");
  f.onReports!();
  expect(spy).toHaveBeenCalledWith({ queryKey: ["client-overview"] });
  expect(spy).toHaveBeenCalledWith({ queryKey: ["clients"] });
  fireEvent.click(screen.getByRole("button", { name: "Show archived" }));
});
