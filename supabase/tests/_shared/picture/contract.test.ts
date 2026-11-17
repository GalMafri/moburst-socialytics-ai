// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../../paths.ts";
import { PICTURE_API_BASE, PICTURE_CALL_TIMEOUT_MS, PICTURE_CALL_HEADER, PICTURE_CALL_MAX_AGE_SECONDS, PICTURE_ROUTES, PICTURE_SERVICE_URL, TITLE_ALPHA_MIN, TITLE_GROUND, type LocateRequest } from "../../../functions/_shared/picture/contract";

describe("the picture service contract", () => {
  it("names the service's production address and route base, with no environment to set", () => {
    // The production domain of the app's own Vercel project, moburst-socialytics (its domain list, read 16 Nov 2026).
    expect(PICTURE_SERVICE_URL).toBe("https://moburst-socialytics.vercel.app");
    expect(PICTURE_API_BASE).toBe("/api/picture");
  });
  it("lists the ten routes", () => {
    expect(PICTURE_ROUTES).toEqual(["canvas", "locate", "read", "finish", "transcode", "title-read", "logo-set", "post-logos", "slot", "slot-file"]);
  });
  it("still takes a locate request with one logo and one background", () => {
    // The type check is the test: a job with one file sends exactly this.
    const one: LocateRequest = { job: "j", step: "locate", design: "d", logo: "l", placement: { anchor: "center", width: 0.25, top: 0.04 }, background: [1, 2, 3], scales: [0.45, 1.35] };
    const set: LocateRequest = { job: "j", step: "locate", design: "d", placement: { anchor: "center", width: 0.25, top: 0.04 }, scales: [0.45, 1.35], templates: [{ file: "stored", logo: "l", ground: [1, 2, 3] }], compare: [{ file: "white", logo: "w" }] };
    expect("logo" in one && "templates" in set).toBe(true);
  });
  it("bounds every call well inside an edge request's wall time", () => {
    expect(PICTURE_CALL_TIMEOUT_MS).toBe(60_000);
  });
  it("carries a call's id and no secret, and gives a call longer to be claimed than a call may take", () => {
    expect(PICTURE_CALL_HEADER).toBe("x-socialytics-call");
    expect(PICTURE_CALL_MAX_AGE_SECONDS).toBe(120);
    expect(PICTURE_CALL_MAX_AGE_SECONDS * 1000).toBeGreaterThan(PICTURE_CALL_TIMEOUT_MS);
  });
  it("gives a call the same time to be claimed as the database does", () => {
    const sql = readFileSync(join(functionsDir, "..", "migrations", "20261116100000_picture_calls.sql"), "utf8");
    expect(sql).toContain(`interval '${PICTURE_CALL_MAX_AGE_SECONDS} seconds'`);
  });
  it("keeps the title read-back's ground and threshold as the worker had them", () => {
    expect(TITLE_GROUND).toEqual([70, 70, 76]);
    expect(TITLE_ALPHA_MIN).toBe(16);
  });
});
