/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PublicProfiles } from "@/components/clients/PublicProfiles";

const f = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => { const q: any = { select: () => q, eq: () => Promise.resolve({ data: f.rows, error: null }) }; return q; },
  rpc: async () => ({ data: null, error: null }),
} }));

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PublicProfiles clientId="c1" /></QueryClientProvider>);
beforeEach(() => { f.rows = []; });
afterEach(cleanup);

describe("the client's public profiles", () => {
  it("name a provider's id by its platform only, and a readable handle as itself", async () => {
    f.rows = [
      { platform: "youtube", handle: "UCtyXEjQ6RqDX7mNn1Zb3k9A", url: "https://www.youtube.com/channel/UCtyXEjQ6RqDX7mNn1Zb3k9A", source: "website" },
      { platform: "facebook", handle: "1761291", url: null, source: "website" },
      { platform: "instagram", handle: "baderlaw", url: "https://www.instagram.com/baderlaw/", source: "rivaliq" },
    ];
    mount();
    expect(await screen.findByText("@baderlaw")).toBeInTheDocument();
    expect(screen.queryByText(/UCtyXEjQ/)).toBeNull();
    expect(screen.queryByText(/1761291/)).toBeNull();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
  });

  it("names its sources without a vendor", async () => {
    f.rows = [{ platform: "instagram", handle: "baderlaw", url: null, source: "rivaliq" }, { platform: "tiktok", handle: "baderlaw", url: null, source: "website" }];
    const { container } = mount();
    expect(await screen.findByText("From competitor tracking")).toBeInTheDocument();
    expect(screen.getByText("From the website")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/RivalIQ/);
  });

  it("states what is on file for a client with none, with no vendor and no promise", async () => {
    const { container } = mount();
    expect(await screen.findByText("None are on file. They come from competitor tracking and the client's website.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/RivalIQ|within a day/);
  });
});
