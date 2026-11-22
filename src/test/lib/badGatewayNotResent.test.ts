// QA 22 Nov 2026 (P15-03): a 502 can come after the work started. This
// project's own functions answer 502 once they have done part of it
// (revise-suggestion after the model's answer, schedule-sprout-post
// "sprout_not_answering", generate-post-image after Higgsfield failed), so a
// 502 is no sign the request never reached the work. Only a call the server
// answers once however often it is asked is sent again on a 502.
import { describe, expect, it, vi } from "vitest";
import { safeToResend } from "@/lib/invokeError";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const badGateway = { message: "Edge Function returned a non-2xx status code", context: { status: 502 } };

describe("a 502 reply", () => {
  it("is not taken as a request that never reached the work", () => {
    expect(safeToResend(badGateway)).toBe(false);
    expect(invokeResendable(badGateway)).toBe(false);
    expect(invokeResendable(badGateway, { idempotent: true })).toBe(true);
  });

  it("is not sent again for work that may already have run", async () => {
    let sends = 0;
    await sendQuietly(async () => { sends++; return { error: badGateway }; }, { wait: async () => {} });
    expect(sends).toBe(1);
  });

  it("still sends again when the gateway was busy or the function did not start", () => {
    expect(safeToResend({ context: { status: 503 } })).toBe(true);
    expect(safeToResend({ context: { status: 429 } })).toBe(true);
    expect(safeToResend({ name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" })).toBe(true);
  });
});
