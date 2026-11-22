// QA 22 Nov 2026 (P10-01): a strategy card whose lines are all removed ("What we avoid", "Not now") is sent as
// p_text "" with a fields object. strategy_section_save_as refuses exactly that
// (supabase/migrations/20261110170000_strategy_v2.sql:144-146, 22023 "A section needs its text."),
// a refusal writeResendable never resends, so the sheet says "not saved yet" on every press, for ever.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const calls: Array<Record<string, unknown>> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      // The server rule, as written in strategy_section_save_as (lines 135-146).
      const text = String(args.p_text ?? "").trim();
      if (text === "" && args.p_value !== null) return { data: null, error: { code: "22023", message: "A section needs its text." } };
      return { data: { section_key: args.p_key, text, value: args.p_value, editor_name: "Neria", edited_at: "2026-11-20T10:00:00Z", source: "app" }, error: null };
    },
  },
}));

import { useSectionEdit } from "@/components/strategy/StrategySection";

const product = { items: [{ pattern: "Stock photos", source: "team" }, { pattern: "Long captions", source: "team" }] };

describe("P10-01 emptying a strategy card", () => {
  it("saves a 'What we avoid' card with every line removed", async () => {
    const { result } = renderHook(() => useSectionEdit({ clientId: "c1", sectionKey: "avoid", product, onSaved: () => {} }));
    act(() => result.current.start());
    act(() => result.current.setField("patterns", ""));
    await act(async () => { await result.current.save(); });
    expect(calls.at(-1)).toMatchObject({ p_text: "Nothing listed.", p_value: { items: [] } });
    // The save goes through and closes the sheet.
    expect(result.current.notSaved).toBe(false);
    expect(result.current.open).toBe(false);
  });
});
