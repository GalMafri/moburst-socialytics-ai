import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ onChange: null as null | ((p: unknown) => void) }));
vi.mock("@/integrations/supabase/client", () => {
  const channel: any = {
    on: (_e: string, _o: unknown, cb: (p: unknown) => void) => { f.onChange = cb; return channel; },
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: () => {} } };
});

import { useRealtimeReports } from "@/hooks/useRealtimeReport";

describe("useRealtimeReports", () => {
  it("a finished report also refreshes the client overview", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    renderHook(() => useRealtimeReports("c1"), { wrapper });
    f.onChange!({ new: { id: "r1", status: "complete" } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["client-overview"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["clients"] });
  });
});
