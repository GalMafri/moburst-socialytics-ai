// P18-03: "Refresh now" on the competitor feed, refused by the server (the
// client is not tracked in RivalIQ, 422), ends with the screen exactly as it
// was: no toast, no line, the old "Pulled" time. The control looks dead.
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CompetitiveFeed from "@/pages/CompetitiveFeed";

const fx = vi.hoisted(() => ({ invoked: [] as string[], toasts: [] as unknown[] }));
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
        // What supabase-js returns for a 422 from the function.
        return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError", context: { status: 422 } }) };
      },
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
        then: (resolve: (r: unknown) => unknown) => {
          if (table === "clients") return Promise.resolve({ data: { id: "c1", name: "Moburst", timezone: "UTC", primary_platforms: [] }, error: null }).then(resolve);
          const payload = { window: { start: "2026-11-05", end: "2026-11-11" }, socialPosts: [{ companyName: "Peer", channel: "instagram", message: "A post", publishedAt: "2026-11-10", postLink: "https://example.com/1" }] };
          return Promise.resolve({ data: [{ id: "snap", fetched_at: "2026-11-12T08:00:00Z", landscape_id: "ls", payload }], error: null }).then(resolve);
        },
      };
      return q;
    },
  },
}));

afterEach(() => cleanup());

it("shows the true state after a refresh the server refused", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/clients/c1/competitive/feed"]}><Routes><Route path="/clients/:id/competitive/feed" element={<CompetitiveFeed />} /></Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByText("A post");
  const before = document.body.textContent;
  fireEvent.click(screen.getByRole("button", { name: /Refresh now/ }));
  await screen.findByText("Refresh the competitor feed?");
  fireEvent.click(screen.getAllByRole("button", { name: "Refresh now" }).at(-1)!); // the dialog's confirm
  await waitFor(() => expect(fx.invoked).toEqual(["refresh-competitor-feed"]));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /Refresh now/ })[0]).toBeEnabled());
  await new Promise((r) => setTimeout(r, 50));
  expect(fx.toasts).toEqual([]);
  // Expected: something on screen changes to say the feed was not refreshed (the true state). Actual: identical page.
  expect(document.body.textContent).not.toEqual(before);
  expect(screen.getByRole("status")).toHaveTextContent("Not refreshed yet.");
});
