// The model call the report text correction binds: it leaves the model room
// to think before it writes the sentences, and a reply that was cut off or
// declined reads as empty, which the correction's own check refuses (so the
// job retries on its schedule and nothing is written). 18 Nov 2026.
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPORT_TEXT_MODEL, sonnetCompletion } from "../../../functions/_shared/reports/correctText";
import { checkCorrection, parseCorrection } from "../../../functions/_shared/reports/reportText";
import { roomFor } from "../../../functions/_shared/anthropicReply";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sonnetCompletion", () => {
  it("asks with room for thinking, and gives nothing of a reply that did not finish", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sent: Array<{ model: string; max_tokens: number }> = [];
    let stop = "end_turn";
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"sentences":[]}' }], stop_reason: stop }));
    });
    const complete = sonnetCompletion("k");
    expect(await complete("system", "message")).toBe('{"sentences":[]}');
    expect([sent[0].model, sent[0].max_tokens]).toEqual([REPORT_TEXT_MODEL, roomFor(4000)]);
    for (stop of ["max_tokens", "refusal"]) expect(await complete("system", "message")).toBe("");
    // An empty reply is one the correction refuses, as it refuses any reply it cannot read.
    const stale = [{ id: "s1", path: "summary", sentence: "Reach rose 12%.", numbers: [] }] as never;
    expect(checkCorrection(stale, parseCorrection(""), [])).toBe("The answer could not be read.");
  });
});
