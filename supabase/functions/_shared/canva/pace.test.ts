import { describe, it, expect } from "vitest";
import { Pace, backoffMs } from "./pace";

describe("Canva pacing", () => {
  it("lets calls through up to the limit in a minute, then says how long to wait", () => {
    let t = 0;
    const pace = new Pace({ start: 2 }, 60_000, () => t);
    expect(pace.tryTake("start")).toBe(0);
    t = 10_000;
    expect(pace.tryTake("start")).toBe(0);
    t = 20_000;
    expect(pace.tryTake("start")).toBe(40_025);
    t = 60_001;
    expect(pace.tryTake("start")).toBe(0);
    expect(pace.tryTake("unlimited")).toBe(0);
  });
  it("backs off by Retry-After when Canva gives it, else exponentially, bounded", () => {
    expect(backoffMs("3", 0)).toBe(3000);
    expect(backoffMs(null, 0)).toBe(1000);
    expect(backoffMs(null, 3)).toBe(8000);
    expect(backoffMs(null, 10)).toBe(30_000);
    expect(backoffMs("999", 0)).toBe(60_000);
  });
});
