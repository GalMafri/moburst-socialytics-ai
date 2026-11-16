import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const f = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string, args?: unknown) => f.rpc(fn, args) } }));

import { UserDetail } from "@/components/usage/UserDetail";

const row = (over: Record<string, unknown>) => ({ metric: "", tone: "plain", kind: "text", value: null, at: null, amount: null, ...over });
const OLD_TZ = process.env.TZ;

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UserDetail email="ada@moburst.com" name="Ada Lovelace" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  f.rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_user_detail") {
      return { data: [
        row({ metric: "Provisioned", kind: "date", at: "2026-11-03T23:30:00Z" }),
        row({ metric: "Last sign-in", kind: "date", at: null }),
        row({ metric: "Median analysis minutes", kind: "number", amount: 12.345 }),
        row({ metric: "Longest gap (days)", kind: "number", amount: null }),
        row({ metric: "Analyses run", value: "7" }),
      ], error: null };
    }
    return { data: [], error: null };
  });
});
afterEach(() => { cleanup(); if (OLD_TZ === undefined) delete process.env.TZ; else process.env.TZ = OLD_TZ; });

const valueOf = (dialog: HTMLElement, metric: string) => within(dialog).getByText(metric).nextElementSibling?.textContent;

describe("a person's detail panel", () => {
  it("writes the dates in the viewer's time zone with the app's date style, and a missing one as Never", async () => {
    process.env.TZ = "Pacific/Auckland";
    open();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Provisioned");
    // 23:30 UTC on Nov 3 is already Nov 4 for the viewer.
    expect(valueOf(dialog, "Provisioned")).toBe("Nov 4, 2026");
    expect(valueOf(dialog, "Last sign-in")).toBe("Never");
  });

  it("rounds the median with the one shared rule, and writes a missing figure as No data", async () => {
    open();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Median analysis minutes");
    expect(valueOf(dialog, "Median analysis minutes")).toBe("12.3");
    expect(valueOf(dialog, "Longest gap (days)")).toBe("No data");
    expect(valueOf(dialog, "Analyses run")).toBe("7");
  });
});
