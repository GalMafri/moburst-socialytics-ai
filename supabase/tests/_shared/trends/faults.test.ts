// @vitest-environment node
// What a failed trend source's answer says: a fact about the request the app
// sent, a fact about the collecting account, or a fault that passes on its own.
import { describe, expect, it } from "vitest";
import { failedSources, sourceFault, sourceFaultKind } from "../../../functions/_shared/trends/faults";

describe("a failed source's answer", () => {
  it("reads a refused input (400) and other answers about the request as request facts", () => {
    // TikTok's source, 13 to 16 Nov 2026.
    expect(sourceFaultKind('Apify POST /acts/5K30i8aFccKNF5ICs/runs answered 400: {"error":{"type":"invalid-input","message":"Field input.profileSorting must be equal to one of the allowed values"}}'))
      .toEqual({ kind: "request", status: 400 });
    expect(sourceFaultKind("Apify POST /acts/gone/runs answered 404: Actor was not found")).toEqual({ kind: "request", status: 404 });
    expect(sourceFaultKind("Apify POST /acts/x/runs answered 422: unprocessable")).toEqual({ kind: "request", status: 422 });
    // The same fact without a status in the message.
    expect(sourceFaultKind("Field input.profileSorting must be equal to one of the allowed values")).toEqual({ kind: "request", status: null });
  });

  it("reads a refused account (401, 402, 403) as a credentials fact", () => {
    // Every source, 12 Nov 2026.
    expect(sourceFaultKind('Apify POST /acts/x/runs answered 401: {"error":{"type":"user-or-token-not-found","message":"User was not found or authentication token is not valid"}}'))
      .toEqual({ kind: "credentials", status: 401 });
    expect(sourceFaultKind("Apify POST /acts/x/runs answered 402: not-enough-usage-to-run-paid-actor")).toEqual({ kind: "credentials", status: 402 });
    expect(sourceFaultKind("Apify POST /acts/x/runs answered 403: this actor is not rented")).toEqual({ kind: "credentials", status: 403 });
    expect(sourceFaultKind("User was not found or authentication token is not valid")).toEqual({ kind: "credentials", status: null });
    // A run that stopped at the week's end still waiting for the account.
    expect(sourceFaultKind("The run waited for APIFY_API_TOKEN until 2026-11-22T22:00:00.000Z, the latest its wait may last, so it stopped.").kind).toBe("credentials");
  });

  it("reads everything else as transient: the app's own to try again", () => {
    for (const message of [
      "Apify GET /actor-runs/abc answered 500: internal error", "Apify POST /acts/x/runs answered 429: rate limit", "Apify GET /datasets/d/items answered 408: timeout",
      "Apify run abc ended FAILED.", "Apify run abc ended TIMED-OUT.", "The tiktok source brought back nothing (run r1).", "the step ran past its 110 s", "fetch failed", "",
    ]) expect(sourceFaultKind(message).kind).toBe("transient");
    expect(sourceFaultKind("Apify POST /acts/x/runs answered 503: unavailable")).toEqual({ kind: "transient", status: 503 });
  });

  it("keeps the source's words short", () => {
    const fault = sourceFault("tiktok", `Apify POST /acts/x/runs answered 400: ${"x".repeat(500)}`);
    expect(fault).toMatchObject({ platform: "tiktok", kind: "request", status: 400 });
    expect(fault.message).toHaveLength(300);
  });

  it("names the sources a week's row says failed, in the app's order of platforms", () => {
    expect(failedSources({ youtube: { status: "failed" }, tiktok: { status: "failed" }, instagram: { status: "ok" }, linkedin: { status: "not_watched" }, pinterest: null })).toEqual(["tiktok", "youtube"]);
    expect(failedSources({})).toEqual([]);
    expect(failedSources(null)).toEqual([]);
  });
});
