import { describe, expect, it, vi } from "vitest";
import { queueCalendarWork, SEND_WAITS_MS } from "@/lib/calendarRequests";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

const httpError = (status: number) => ({ message: "Edge Function returned a non-2xx status code", context: { status } });

describe("queueCalendarWork", () => {
  it("sends again quietly, with growing waits, when the request didn't get through", async () => {
    const waits: number[] = [];
    const invoke = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ data: null, error: httpError(503) })
      .mockResolvedValueOnce({ data: { week: "2026-10-26" }, error: null });
    const out = await queueCalendarWork({ action: "plan_next_week", client_id: "c" }, { invoke, wait: async (ms) => { waits.push(ms); } });
    expect(out).toEqual({ week: "2026-10-26" });
    expect(waits).toEqual(SEND_WAITS_MS.slice(0, 2));
    expect(invoke).toHaveBeenCalledWith("calendar-posts", { body: { action: "plan_next_week", client_id: "c" } });
  });

  it("gives up quietly after the last wait, and doesn't ask again when the server turned it down", async () => {
    const down = vi.fn().mockResolvedValue({ data: null, error: { message: "Failed to send a request to the Edge Function" } });
    expect(await queueCalendarWork({}, { invoke: down, wait: async () => {} })).toBeNull();
    expect(down).toHaveBeenCalledTimes(SEND_WAITS_MS.length + 1);
    const refused = vi.fn().mockResolvedValue({ data: null, error: httpError(409) });
    expect(await queueCalendarWork({}, { invoke: refused, wait: async () => {} })).toBeNull();
    expect(refused).toHaveBeenCalledTimes(1);
  });
});
