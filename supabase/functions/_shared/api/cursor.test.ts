import { describe, it, expect } from "vitest";
import { decodeCursor, encodeCursor, pageOf, parseLimit } from "./cursor";

describe("cursor", () => {
  it("round-trips through base64url", () => {
    const c = { c: "2026-09-30T10:00:00.000Z", i: "abc-1" };
    const s = encodeCursor(c);
    expect(s).not.toMatch(/[+/=]/);
    expect(decodeCursor(s)).toEqual(c);
  });
  it("returns null for garbage or nothing", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("!!!")).toBeNull();
    expect(decodeCursor(Buffer.from('{"x":1}').toString("base64url"))).toBeNull();
  });
  it("parses and clamps the limit", () => {
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("500")).toBe(200);
    expect(parseLimit("0")).toBe(1);
    expect(() => parseLimit("abc")).toThrow(/limit/);
  });
  it("cuts a page and says whether another exists", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `r${n}`, created_at: `2026-09-0${n}T00:00:00.000Z` }));
    const p = pageOf(rows, 2);
    expect(p.data.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(decodeCursor(p.next_cursor)).toEqual({ c: "2026-09-02T00:00:00.000Z", i: "r2" });
    expect(pageOf(rows, 3).next_cursor).toBeNull();
  });
});
