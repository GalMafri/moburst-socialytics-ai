import { describe, expect, it } from "vitest";
import { canRetry, isStuck, minutesRunning, retryLabel } from "@/lib/reportRun";

const NOW = new Date("2026-09-10T12:00:00Z").getTime();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60000).toISOString();

describe("canRetry", () => {
  it("offers a retry on a failed run", () => {
    expect(canRetry({ status: "failed", created_at: at(5) }, NOW)).toBe(true);
  });

  it("offers a retry on a run that died without saying so", () => {
    // The workflow crashes before its writeback node and the row never moves
    // off "running" — the only signal is the clock.
    expect(canRetry({ status: "running", created_at: at(90) }, NOW)).toBe(true);
    expect(retryLabel({ status: "running", created_at: at(90) }, NOW)).toBe("Stuck — run again");
  });

  it("leaves a run that is genuinely still going alone", () => {
    expect(canRetry({ status: "running", created_at: at(3) }, NOW)).toBe(false);
    expect(isStuck({ status: "running", created_at: at(44) }, NOW)).toBe(false);
  });

  it("never offers a retry on a finished report", () => {
    expect(canRetry({ status: "complete", created_at: at(900) }, NOW)).toBe(false);
    expect(canRetry({ status: "completed", created_at: at(900) }, NOW)).toBe(false);
  });

  it("copes with a row that has no timestamp", () => {
    expect(minutesRunning({ status: "running" }, NOW)).toBe(0);
    expect(canRetry({ status: "running" }, NOW)).toBe(false);
  });
});
