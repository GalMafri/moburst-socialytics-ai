import { describe, expect, it } from "vitest";
import { clipText, clipWithEllipsis, wellFormedBody, wellFormedDeep, wellFormedFetch } from "./clip";

// What the database and the Messages API refuse: half of an emoji in the JSON.
const storable = (s: string) => !/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i.test(JSON.stringify(s));

describe("clipText", () => {
  it("never cuts an emoji in half", () => {
    const text = `${"a".repeat(9)}🎙️ interview`;
    expect(text.slice(0, 10)).not.toSatisfy(storable);
    expect(clipText(text, 10)).toBe(`${"a".repeat(9)}🎙`);
    expect(clipText(text, 10)).toSatisfy(storable);
  });
  it("drops a half emoji already in the source text", () => {
    const cutByANetwork = `Read the full interview \ud83d`;
    expect(clipText(cutByANetwork, 100)).toBe("Read the full interview ");
    expect(clipText("\ude00 lone low half", 100)).toBe(" lone low half");
  });
  it("keeps short text and counts characters, not UTF-16 units", () => {
    expect(clipText("📝📝📝", 3)).toBe("📝📝📝");
    expect(clipText(null, 5)).toBe("");
  });
});

describe("clipWithEllipsis", () => {
  it("ends a shortened text in an ellipsis, at most the given length, and leaves short text alone", () => {
    const post = `Julia Salume was featured on Net Influencer 🎙️ ${"x".repeat(50)}`;
    const out = clipWithEllipsis(post, 45);
    expect(Array.from(out)).toHaveLength(45);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toSatisfy(storable);
    expect(clipWithEllipsis("short", 45)).toBe("short");
  });
});

describe("wellFormedDeep", () => {
  it("drops half emoji from every string in a request body and leaves everything else as it was", () => {
    const body = { model: "m", max_tokens: 10, messages: [{ role: "user", content: [{ type: "text", text: `cut here \ud83d` }, { type: "text", text: "🎙️ whole" }] }], flag: true, n: null };
    expect(wellFormedDeep(body)).toEqual({ model: "m", max_tokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "cut here " }, { type: "text", text: "🎙️ whole" }] }], flag: true, n: null });
  });
});

describe("wellFormedBody and wellFormedFetch", () => {
  const half = JSON.stringify({ text: "cut \ud83d", ok: "🎙️" });
  it("drops half emoji from a JSON body and leaves every other body as it was", () => {
    expect(half).toContain("\\ud83d");
    expect(JSON.parse(wellFormedBody(half))).toEqual({ text: "cut ", ok: "🎙️" });
    const whole = JSON.stringify({ text: "🎙️ whole" });
    expect(wellFormedBody(whole)).toBe(whole);
    expect(wellFormedBody("not json \\ud83d")).toBe("not json \\ud83d");
    const bytes = new Uint8Array([1, 2]);
    expect(wellFormedBody(bytes)).toBe(bytes);
  });
  it("sends the cleaned body through the given fetch, and the request as it was otherwise", async () => {
    const sent: Array<{ input: unknown; init?: RequestInit }> = [];
    const base = (async (input: unknown, init?: RequestInit) => { sent.push({ input, init }); return new Response("{}"); }) as typeof fetch;
    await wellFormedFetch(base)("https://db.test/rest/v1/rows", { method: "POST", headers: { "Content-Type": "application/json" }, body: half });
    await wellFormedFetch(base)("https://db.test/rest/v1/rows?select=*");
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({ text: "cut ", ok: "🎙️" });
    expect(sent[0].init?.method).toBe("POST");
    expect(sent[1]).toEqual({ input: "https://db.test/rest/v1/rows?select=*", init: undefined });
  });
});
