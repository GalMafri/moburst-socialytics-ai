// P18-06: a draft dialog closed (Escape) while its post was being written,
// and the post then not written, leaves "No post yet. Nothing was added to the
// calendar." set; the next "Draft our take" dialog opens already saying it.
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CompetitiveFeed from "@/pages/CompetitiveFeed";

const fx = vi.hoisted(() => ({ invoked: [] as string[], toasts: [] as unknown[], release: null as null | (() => void) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: unknown) => { fx.toasts.push(t); } }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canRunAnalysis: true }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children, actions, meta }: { children: React.ReactNode; actions?: React.ReactNode; meta?: React.ReactNode }) => <main>{meta}{actions}{children}</main> }));
vi.mock("@/components/competitive/PostVisual", async () => {
  const platform = await import("@/lib/platform");
  return { usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, normalizePlatform: platform.normalizePlatform, platformLabel: platform.platformLabel };
});
vi.mock("@/lib/openTopics", () => ({ fetchOpenTopics: async () => [] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (name: string) => {
        fx.invoked.push(name);
        await new Promise<void>((r) => { fx.release = r; });
        // The writer refuses (a 409 from generate-ad-hoc-post).
        return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError", context: { status: 409 } }) };
      },
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
        then: (resolve: (r: unknown) => unknown) => {
          if (table === "clients") return Promise.resolve({ data: { id: "c1", name: "Moburst", timezone: "UTC", primary_platforms: [] }, error: null }).then(resolve);
          const payload = { window: { start: "2026-11-05", end: "2026-11-11" }, socialPosts: [{ companyName: "Peer", channel: "instagram", message: "A post", publishedAt: "2026-11-10", postLink: "https://example.com/1" }, { companyName: "Rival", channel: "instagram", message: "Another post", publishedAt: "2026-11-09", postLink: "https://example.com/2" }] };
          return Promise.resolve({ data: [{ id: "snap", fetched_at: "2026-11-12T08:00:00Z", landscape_id: "ls", payload }], error: null }).then(resolve);
        },
      };
      return q;
    },
  },
}));

afterEach(() => cleanup());

it("opens the next draft dialog without the last one's \"No post yet\"", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/clients/c1/competitive/feed"]}><Routes><Route path="/clients/:id/competitive/feed" element={<CompetitiveFeed />} /></Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByText("A post");
  fireEvent.click(screen.getAllByRole("button", { name: /Draft our take/ })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Draft the post" }));
  await waitFor(() => expect(fx.release).not.toBeNull());
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" }); // the person closes it while it writes
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await act(async () => { fx.release!(); await new Promise((r) => setTimeout(r, 20)); });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /Draft our take/ })[1]).toBeEnabled());
  fireEvent.click(screen.getAllByRole("button", { name: /Draft our take/ })[1]);
  await screen.findByRole("alertdialog");
  // Expected: a fresh dialog, nothing tried yet. Actual: it already says the post was not written.
  expect(screen.queryByText("No post yet. Nothing was added to the calendar.")).toBeNull();
});
