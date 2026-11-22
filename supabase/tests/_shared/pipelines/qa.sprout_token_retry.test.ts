// @vitest-environment node
// P45-03: a Sprout token request that fails once is never asked again inside the reader's own retries.
import { describe, expect, it } from "vitest";
import { sproutReader } from "../../../functions/_shared/pipelines/social/providers";

describe("P45-03 sproutReader retry after a failed token", () => {
  it("asks for the token again on its next try and reads the page", async () => {
    let tokenCalls = 0;
    const token = async () => { tokenCalls += 1; if (tokenCalls === 1) throw new Error("token endpoint blip"); return "***"; };
    const fetchImpl = async () => new Response(JSON.stringify({ data: [], paging: { current_page: 1, total_pages: 1 } }), { status: 200 });
    const reader = sproutReader({ customerId: "c", token, fetchImpl, sleep: async () => {} });
    await expect(reader.pages("profiles", {})).resolves.toHaveLength(1);
  });
});
