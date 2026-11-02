import { describe, expect, it } from "vitest";
import { auditRow, rateCheck, RATE_LIMIT_PER_MINUTE } from "./audit";

const PERSON = "00000000-0000-4000-8000-0000000000aa";
const CLIENT = "00000000-0000-4000-8000-000000000001";

describe("auditRow", () => {
  it("records the call in the API's table: method MCP, the tool as the path, the person and the OAuth client", () => {
    expect(auditRow({ tool: "socialytics_client_get", status: 200, durationMs: 41, clientId: CLIENT, errorCode: null, userId: PERSON, oauthClientId: "oc-1", ip: "203.0.113.9" })).toEqual({
      key_id: null, method: "MCP", path: "mcp/socialytics_client_get", status: 200, duration_ms: 41, client_id: CLIENT, job_id: null, ip: "203.0.113.9", error_code: null, user_id: PERSON, oauth_client_id: "oc-1",
    });
  });

  it("names a client only when the tool was given a client id, and never anything else the call carried", () => {
    const row = auditRow({ tool: "socialytics_report_get", status: 404, durationMs: 3, clientId: "Bader Law", errorCode: "not_found", userId: PERSON, oauthClientId: "oc-1", ip: null });
    expect(row.client_id).toBeNull();
    expect(row.error_code).toBe("not_found");
    expect(Object.keys(row).sort()).toEqual(["client_id", "duration_ms", "error_code", "ip", "job_id", "key_id", "method", "oauth_client_id", "path", "status", "user_id"]);
    expect(auditRow({ tool: "t", status: 200, durationMs: -5, errorCode: null, userId: PERSON, oauthClientId: null, ip: null }).duration_ms).toBe(0);
  });
});

describe("rateCheck", () => {
  const at = new Date("2026-11-09T10:15:42.000Z");

  it("allows 120 calls a minute per person, as the API does per key", () => {
    expect(RATE_LIMIT_PER_MINUTE).toBe(120);
    expect(rateCheck(1, at)).toEqual({ ok: true });
    expect(rateCheck(120, at)).toEqual({ ok: true });
  });

  it("refuses the 121st call with the seconds left in the minute", () => {
    expect(rateCheck(121, at)).toEqual({ ok: false, retryAfter: 18, text: "Too many requests this minute. Try again in 18 seconds." });
    expect(rateCheck(500, new Date("2026-11-09T10:15:59.500Z"))).toEqual({ ok: false, retryAfter: 1, text: "Too many requests this minute. Try again in 1 second." });
  });
});
