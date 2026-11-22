// The OpenAI key: the secret, else the app_settings row. A FINAL error ends
// a design or video job on its first try, so only a read that answered and
// held no key may say FINAL.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiKey } from "../../../functions/_shared/openai/key";

function adminAnswering(answer: { data: unknown; error: unknown }) {
  const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => answer };
  return { from: () => chain };
}

describe("openaiKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the secret when it is set", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "sk-secret" } });
    await expect(openaiKey(adminAnswering({ data: null, error: null }))).resolves.toBe("sk-secret");
  });

  it("reads the key from app_settings when there is no secret", async () => {
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    await expect(openaiKey(adminAnswering({ data: { value: "sk-row" }, error: null }))).resolves.toBe("sk-row");
  });

  it("is final when the settings read answered with no key", async () => {
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    await expect(openaiKey(adminAnswering({ data: null, error: null }))).rejects.toThrow(/^FINAL:/);
  });

  // QA 22 Nov 2026 (P41-04): a failed read is a database blip, retried by
  // the job, never "No OpenAI key is configured".
  it("does not call a failed settings read a final 'no key configured'", async () => {
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    const err = await openaiKey(adminAnswering({ data: null, error: { message: "connection reset by peer" } })).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
    expect(err!.message.startsWith("FINAL:")).toBe(false);
  });
});
