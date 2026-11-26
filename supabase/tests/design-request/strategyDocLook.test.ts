// @vitest-environment node
// An uploaded strategy document's look reaches the design planner (Lital,
// 26 Nov 2026): read once per file, kept on the client, read again for a new
// file, and never a reason for a design to fail.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ calls: [] as unknown[], reply: "- Colours: deep navy with neon lime accents\n- Photography: night-time rinks, cold light" as string, key: true, fail: false }));
vi.mock("../../functions/_shared/anthropic.ts", () => ({
  anthropicMessages: async (args: unknown) => {
    m.calls.push(args);
    if (m.fail) throw new Error("model down");
    return { text: m.reply, stopReason: "end_turn", raw: null };
  },
}));
vi.mock("../../functions/_shared/paid/index.ts", () => ({ hasKey: async () => m.key }));

import { docLookLines, DOC_LOOK_MAX_CHARS, strategyDocLook } from "../../functions/design-request/strategyDocLook";
import { brandGuideLines } from "../../functions/_shared/design/brandGuide";

const cost = { clientId: "c1", feature: "design.strategy_doc_look", actor: "user" } as never;

function db(file: { bytes: number[]; } | null = { bytes: [37, 80, 68, 70] }) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    storage: { from: () => ({ download: async () => ({ data: file ? { arrayBuffer: async () => new Uint8Array(file.bytes).buffer } : null }) }) },
    from: () => ({ update: (row: Record<string, unknown>) => ({ eq: async () => { updates.push(row); return { error: null }; } }) }),
  };
}

beforeEach(() => { m.calls = []; m.reply = "- Colours: deep navy with neon lime accents\n- Photography: night-time rinks, cold light"; m.key = true; m.fail = false; });

describe("the strategy document's look", () => {
  it("is read from the PDF once and kept on the client with the file's path", async () => {
    const d = db();
    const text = await strategyDocLook(d, { id: "c1", strategy_doc_file_path: "Pyper/strategy.pdf", strategy_doc_look: null }, cost);
    expect(text).toBe("- Colours: deep navy with neon lime accents\n- Photography: night-time rinks, cold light");
    expect(m.calls).toHaveLength(1);
    expect(JSON.stringify(m.calls[0])).toContain("application/pdf");
    expect(d.updates[0].strategy_doc_look).toMatchObject({ path: "Pyper/strategy.pdf", text });
  });

  it("is not read again for the same file, and is read again for a new one", async () => {
    const stored = { path: "Pyper/strategy.pdf", read_at: "2026-11-26T10:00:00Z", text: "- Kept" };
    expect(await strategyDocLook(db(), { id: "c1", strategy_doc_file_path: "Pyper/strategy.pdf", strategy_doc_look: stored }, cost)).toBe("- Kept");
    expect(m.calls).toHaveLength(0);
    await strategyDocLook(db(), { id: "c1", strategy_doc_file_path: "Pyper/strategy-v2.pdf", strategy_doc_look: stored }, cost);
    expect(m.calls).toHaveLength(1);
  });

  it("is nothing, with no call, for a client with no document", async () => {
    expect(await strategyDocLook(db(), { id: "c1", strategy_doc_file_path: null }, cost)).toBe("");
    expect(m.calls).toHaveLength(0);
  });

  it("keeps an empty look when the document says nothing about it, so it is not asked again", async () => {
    m.reply = "NONE";
    const d = db();
    expect(await strategyDocLook(d, { id: "c1", strategy_doc_file_path: "Pyper/strategy.pdf" }, cost)).toBe("");
    expect(d.updates[0].strategy_doc_look).toMatchObject({ path: "Pyper/strategy.pdf", text: "" });
  });

  it("never fails a design: a model error or a missing file gives nothing and keeps nothing", async () => {
    m.fail = true;
    const d = db();
    expect(await strategyDocLook(d, { id: "c1", strategy_doc_file_path: "Pyper/strategy.pdf" }, cost)).toBe("");
    expect(d.updates).toHaveLength(0);
    const gone = db(null);
    expect(await strategyDocLook(gone, { id: "c1", strategy_doc_file_path: "Pyper/strategy.pdf" }, cost)).toBe("");
  });

  it("keeps only the reply's lines, cut at the last whole line that fits", () => {
    expect(docLookLines("Here you go:\n- One\nnot a line\n- Two")).toBe("- One\n- Two");
    const long = Array.from({ length: 60 }, (_, i) => `- Line ${i} ${"x".repeat(30)}`).join("\n");
    const cut = docLookLines(long);
    expect(cut.length).toBeLessThanOrEqual(DOC_LOOK_MAX_CHARS);
    expect(cut.split("\n").every((l) => l.startsWith("- Line"))).toBe(true);
  });

  it("goes in the planner's guide after the brand book, which wins where they differ", () => {
    const both = brandGuideLines("Pay The Pyper", { brandBook: "- Colours: primary #111111", strategyDocLook: "- Night-time rinks" });
    expect(both.indexOf("brand book")).toBeLessThan(both.indexOf("strategy document"));
    expect(both).toContain("where it differs from the brand book, the brand book wins");
    const alone = brandGuideLines("Pay The Pyper", { strategyDocLook: "- Night-time rinks" });
    expect(alone).toContain("How Pay The Pyper's strategy document says its posts should look:\n- Night-time rinks");
    expect(alone).not.toContain("brand book wins");
    expect(brandGuideLines("X", { strategyDocLook: "  " })).toBe("");
  });
});
