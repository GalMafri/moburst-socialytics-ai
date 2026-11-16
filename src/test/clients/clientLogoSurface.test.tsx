/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CompetitiveIndex from "@/pages/CompetitiveIndex";
import { fetchActiveClients } from "@/lib/activeClients";

// The clients table answers with a client's logo surface only when the read asks for it,
// as the real one does: a screen that reads bare columns gets no surface.
const client = { id: "a", name: "Twos", logo_url: "https://example.com/black.svg", archived_at: null };
const surface = { logo_path: "a/brand/logo.png", background: "#FFFFFF" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canRunAnalysis: true, canManageClients: true }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: (b: string) => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://files.test/${b}/${p}` } }) }) },
    from: (table: string) => {
      let columns = "";
      const q: any = {
        select: (c: string) => { columns = c; return q; }, is: () => q, in: () => q, eq: () => q,
        order: () => q,
        then: (ok: any, no: any) => Promise.resolve({
          data: table === "clients" ? [columns.includes("design_brand_settings") ? { ...client, design_brand_settings: surface } : client] : [],
          error: null,
        }).then(ok, no),
      };
      return q;
    },
  },
}));
afterEach(() => cleanup());

it("every shared read of clients carries the logo surface", async () => {
  const rows = await fetchActiveClients<any>("id, name, logo_url");
  expect(rows[0].design_brand_settings).toEqual(surface);
});

it("the Competitive page picker draws a dark logo on the client's own surface", async () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CompetitiveIndex /></MemoryRouter></QueryClientProvider>);
  await screen.findAllByText("Twos");
  const logo = document.querySelector("aside img") as HTMLImageElement;
  expect(logo.getAttribute("src")).toBe("https://files.test/generated-media/a/brand/logo.png");
  expect((logo.parentElement as HTMLElement).style.backgroundColor).toBe("rgb(255, 255, 255)");
});
