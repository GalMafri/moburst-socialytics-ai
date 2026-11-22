// QA 22 Nov 2026 (P11): useSproutSync.ts:58-72. The button is enabled while the dashboard's first
// sync_status read is still in flight. A press puts the run's answer ({open:true}) in the
// cache, then the older read lands with {open:false} and overwrites it. The page has
// "watched" a run, so it says the previous run's ending, drops busy and stops polling
// while the run it just queued is under way.
import { expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const f = vi.hoisted(() => ({ resolveRead: null as null | ((v: unknown) => void) }));
vi.mock("@/lib/sproutSync", async (orig) => {
  const real = await orig<typeof import("@/lib/sproutSync")>();
  return {
    ...real,
    // The first read is slow (an edge function cold start); it was taken before the press.
    readSproutSync: () => new Promise((r) => { f.resolveRead = r; }),
    startSproutSync: async () => ({ started: true, sync: { open: true, slow: false, last: null } }),
  };
});
import { useSproutSync } from "@/hooks/useSproutSync";

it("stays busy after a press made while the first status read was in flight", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useSproutSync(true), { wrapper });
  await act(async () => { result.current.start(); });
  expect(result.current.busy).toBe(true); // the run it started is open
  // The read taken before the press now answers: no run under way, the last one finished with nothing new.
  await act(async () => { f.resolveRead!({ open: false, slow: false, last: { finished: true, added: [] } }); });
  expect(result.current.line).toBeNull();
  expect(result.current.busy).toBe(true);
});
