import { describe, expect, it, vi } from "vitest";
import { describeInvokeError, safeToResend, withQuietRetry } from "@/lib/invokeError";
import { insightKey as browserInsightKey } from "@/hooks/useInsightFeedback";
import { insightKey as edgeInsightKey } from "../../../supabase/functions/_shared/reports/payloads";
import { bytesToBase64 } from "../../../supabase/functions/_shared/higgsfield/renderImage";

/**
 * describeInvokeError is how a failed request of a person's own reaches the
 * screen. It returns one plain sentence by error code or HTTP status; the
 * server's own text ("DB update failed", "could not parse JSON from Claude
 * output") goes to the console only.
 */
describe("describeInvokeError", () => {
  const withContext = (status: number, body?: unknown) => ({
    message: "Edge Function returned a non-2xx status code",
    context: {
      status,
      clone: () => ({ json: async () => { if (body === undefined) throw new Error("not json"); return body; } }),
    },
  });
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("never shows the server's own text", async () => {
    quiet();
    for (const raw of ["DB update failed", "could not parse JSON from Claude output", "Moburst staff only."]) {
      expect(await describeInvokeError(withContext(500, { error: raw }))).not.toContain(raw);
      expect(await describeInvokeError(withContext(400), { error: raw })).not.toContain(raw);
    }
  });

  it("keeps the real text in the console", async () => {
    const log = quiet();
    await describeInvokeError(withContext(500, { error: "DB update failed" }));
    expect(JSON.stringify(log.mock.calls)).toContain("DB update failed");
  });

  it("chooses a plain sentence by status", async () => {
    quiet();
    expect(await describeInvokeError(withContext(401))).toMatch(/session has ended/i);
    expect(await describeInvokeError(withContext(403))).toMatch(/does not have access/i);
    expect(await describeInvokeError(withContext(504))).toMatch(/longer than the server allows/i);
    expect(await describeInvokeError(withContext(500))).toMatch(/did not go through/i);
    expect(await describeInvokeError(withContext(502))).toMatch(/did not go through/i);
  });

  it("chooses a plain sentence by code when the function sent one", async () => {
    quiet();
    expect(await describeInvokeError(withContext(422, { error: "RIVALIQ_CLIENT_NOT_TRACKED: x", code: "RIVALIQ_CLIENT_NOT_TRACKED" }))).toMatch(/tracking for this client is still starting/i);
  });

  it("says the request was not sent when there was no response at all", async () => {
    quiet();
    expect(await describeInvokeError({ name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" })).toMatch(/could not be sent/i);
    expect(await describeInvokeError(null)).toMatch(/did not go through/i);
  });

  it("never returns the generic supabase message", async () => {
    quiet();
    expect(await describeInvokeError(withContext(401))).not.toMatch(/non-2xx/);
  });
});

describe("withQuietRetry", () => {
  it("sends again quietly when the request never reached the work", async () => {
    let calls = 0;
    const result = await withQuietRetry(async () => (++calls < 3 ? { error: { name: "FunctionsFetchError", message: "Failed to fetch" } } : { error: null }), { waitMs: 0 });
    expect(calls).toBe(3);
    expect(result.error).toBeNull();
  });

  it("does not resend work that may have started", async () => {
    let calls = 0;
    await withQuietRetry(async () => { calls++; return { error: { context: { status: 500 } } }; }, { waitMs: 0 });
    expect(calls).toBe(1);
    expect(safeToResend({ context: { status: 504 } })).toBe(false);
    expect(safeToResend({ context: { status: 503 } })).toBe(true);
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
