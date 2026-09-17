import { describe, expect, it } from "vitest";
import { describeInvokeError } from "@/lib/invokeError";
import { insightKey as browserInsightKey } from "@/hooks/useInsightFeedback";
import { insightKey as edgeInsightKey } from "../../../supabase/functions/_shared/reports/payloads";
import { bytesToBase64 } from "../../../supabase/functions/_shared/higgsfield/renderImage";

/**
 * describeInvokeError is how every failure from an edge function reaches a
 * person. It matters more since 18 functions were gated: without it, a signed
 * -out staff member sees "Edge Function returned a non-2xx status code".
 */
describe("describeInvokeError", () => {
  const withContext = (status: number, body?: unknown) => ({
    message: "Edge Function returned a non-2xx status code",
    context: {
      status,
      clone: () => ({ json: async () => { if (body === undefined) throw new Error("not json"); return body; } }),
    },
  });

  it("prefers the error the function actually sent", async () => {
    expect(await describeInvokeError(withContext(403), { error: "Moburst staff only." })).toBe("Moburst staff only.");
  });

  it("reads the body off the response when data carries nothing", async () => {
    expect(await describeInvokeError(withContext(400, { error: "prompt is required" }))).toBe("prompt is required");
  });

  it("falls back to message when the body has no error key", async () => {
    expect(await describeInvokeError(withContext(400, { message: "bad request" }))).toBe("bad request");
  });

  it("explains the three statuses a person can act on", async () => {
    expect(await describeInvokeError(withContext(401))).toMatch(/session has expired/i);
    expect(await describeInvokeError(withContext(403))).toMatch(/do not have access/i);
    expect(await describeInvokeError(withContext(504))).toMatch(/took too long/i);
  });

  it("names any other status rather than hiding it", async () => {
    expect(await describeInvokeError(withContext(500))).toBe("Server error 500");
  });

  it("never returns the generic supabase message when it can do better", async () => {
    const out = await describeInvokeError(withContext(401));
    expect(out).not.toMatch(/non-2xx/);
  });

  it("degrades to the raw message when there is no context at all", async () => {
    expect(await describeInvokeError({ message: "network down" })).toBe("network down");
    expect(await describeInvokeError(null)).toBe("Request failed");
  });

  it("survives a body that is not JSON", async () => {
    expect(await describeInvokeError(withContext(502))).toBe("Server error 502");
  });
});

/**
 * Two copies of insightKey exist: the browser writes these keys and the edge
 * function reads them back. If they ever disagree, thumbs-up and thumbs-down
 * feedback silently stops matching the gap it was given for.
 */
describe("insightKey agrees across the browser and the edge function", () => {
  const cases = [
    "No repeatable Reels series",
    "  Leading and trailing space  ",
    "Punctuation, and — dashes! (parens)",
    "MiXeD CaSe",
    "already-slugged-text",
    "123 numbers 456",
    "",
    "!!!",
    "a".repeat(200),
    "Ünïcôde and emoji 🎉 mixed in",
  ];

  it("returns the same key for every input", () => {
    for (const c of cases) {
      expect(browserInsightKey(c), JSON.stringify(c)).toBe(edgeInsightKey(c));
    }
  });

  it("handles null and undefined identically", () => {
    expect(browserInsightKey(null)).toBe(edgeInsightKey(null));
    expect(browserInsightKey(undefined)).toBe(edgeInsightKey(undefined));
  });

  it("never returns an empty key, because it is used as an identifier", () => {
    for (const c of ["", "   ", "!!!", null, undefined]) {
      expect(browserInsightKey(c as any)).toBe("untitled");
    }
  });

  it("caps at 120 characters so a long gap cannot overflow the column", () => {
    expect(browserInsightKey("a".repeat(500)).length).toBe(120);
  });
});

/**
 * bytesToBase64 exists because btoa() on a multi-megabyte string blows the
 * stack. The chunk boundary is the only interesting thing about it, and it
 * was never exercised.
 */
describe("bytesToBase64", () => {
  const CHUNK = 0x8000;
  const expected = (b: Uint8Array) => {
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
  };

  it("matches a plain btoa on small input", () => {
    const b = new Uint8Array([0, 1, 2, 250, 255]);
    expect(bytesToBase64(b)).toBe(expected(b));
  });

  it("is correct exactly on, either side of, and well past the chunk boundary", () => {
    for (const n of [CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 2, CHUNK * 2 + 7]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = i % 256;
      expect(bytesToBase64(b), `length ${n}`).toBe(expected(b));
    }
  });

  it("handles an empty array", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });

  it("does not blow the stack on a few megabytes", () => {
    const b = new Uint8Array(3_000_000);
    for (let i = 0; i < b.length; i += 997) b[i] = i % 256;
    expect(() => bytesToBase64(b)).not.toThrow();
    expect(bytesToBase64(b).length).toBeGreaterThan(3_000_000);
  });
});
