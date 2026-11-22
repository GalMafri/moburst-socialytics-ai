// @vitest-environment node
// QA 22 Nov 2026 (P30): Re-identify can save the client itself as one of its own competitors.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const reply = vi.hoisted(() => ({ text: "" }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({
  anthropicMessages: async () => ({ text: reply.text, stopReason: "end_turn" }),
}));
const { identifyCompetitors } = await import("../../../functions/_shared/competitive/identify");
afterEach(() => vi.unstubAllGlobals());

const page = () => new Response(`<html><head><title>Firm</title></head><body>${"a law firm ".repeat(30)}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });

describe("P30 identifyCompetitors", () => {
  it("never proposes the client as its own competitor (client with no website on file)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page()));
    reply.text = '{"name":"Bader Law","website_url":"https://baderlaw.com","rationale":"r","similarity_score":0.99},' +
      '{"name":"Peer Law","website_url":"https://peerlaw.com","rationale":"r","similarity_score":0.8},' +
      '{"name":"Other Law","website_url":"https://otherlaw.com","rationale":"r","similarity_score":0.7},' +
      '{"name":"Third Law","website_url":"https://thirdlaw.com","rationale":"r","similarity_score":0.6}]}';
    const db = fakeDb({ competitor_sets: [], competitors: [] });
    const out = await identifyCompetitors(db, { id: "cl-1", name: "Bader Law", website_url: null }, "k", { postsText: "[Instagram] Injured? Call Bader Law" });
    expect(out.competitors.map((c: { name: string }) => c.name)).not.toContain("Bader Law");
  });

  it("knows the client under its legal suffix", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page()));
    reply.text = '{"name":"Bader Law, P.C.","website_url":"https://baderlawfirm.com","rationale":"r","similarity_score":0.99},' +
      '{"name":"Peer Law","website_url":"https://peerlaw.com","rationale":"r","similarity_score":0.8},' +
      '{"name":"Other Law","website_url":"https://otherlaw.com","rationale":"r","similarity_score":0.7},' +
      '{"name":"Third Law","website_url":"https://thirdlaw.com","rationale":"r","similarity_score":0.6}]}';
    const db = fakeDb({ competitor_sets: [], competitors: [] });
    const out = await identifyCompetitors(db, { id: "cl-1", name: "Bader Law", website_url: null }, "k", { postsText: "[Instagram] Injured? Call Bader Law" });
    expect(out.competitors.map((c: { name: string }) => c.name)).toEqual(["Peer Law", "Other Law", "Third Law"]);
  });
});
