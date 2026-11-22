import { it, expect, vi } from "vitest";

const insert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { access_token: "***" } } }) },
  from: () => ({ insert: (rows: unknown[]) => insert(rows) }),
} }));

import { track, flush } from "@/lib/telemetry";

// One row the database refuses for good (RLS on client_id: 42501) should not
// hold every later event hostage and be sent again on every flush for ever.
it("a batch refused for a non-retryable reason is not resent on every flush", async () => {
  insert.mockResolvedValue({ error: { code: "42501", message: "new row violates row-level security policy" } });
  track("competitor_set_confirmed", { client_id: "deleted-client", ok: true });
  for (let i = 0; i < 5; i++) await flush();
  track("page_viewed", { route: "/" });
  await flush();
  // Every flush resent the refused row; the good event never got through on its own.
  const sendsOfRefusedRow = insert.mock.calls.filter(([rows]) => (rows as any[]).some((r) => r.client_id === "deleted-client")).length;
  expect(sendsOfRefusedRow).toBeLessThanOrEqual(1);
});
