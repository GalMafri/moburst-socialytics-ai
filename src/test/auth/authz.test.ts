import { describe, expect, it } from "vitest";
import {
  AuthzError,
  authzResponse,
  bearerToken,
} from "../../../supabase/functions/_shared/auth/authz";

const CORS = { "Access-Control-Allow-Origin": "*" };

describe("bearerToken", () => {
  it("takes the token out of a normal header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("does not care about the case of the scheme", () => {
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("BEARER abc")).toBe("abc");
  });

  it("tolerates extra whitespace on either side", () => {
    expect(bearerToken("  Bearer   abc  ")).toBe("abc");
  });

  it("treats a missing or empty header as no credential", () => {
    for (const v of [null, undefined, "", "   "]) expect(bearerToken(v)).toBe("");
  });

  it("refuses anything that is not a bearer token rather than passing it through", () => {
    // A raw value here would previously survive the old regex replace and be
    // handed to getUser as if it were a JWT.
    expect(bearerToken("abc.def.ghi")).toBe("");
    expect(bearerToken("Basic dXNlcjpwYXNz")).toBe("");
    expect(bearerToken("Bearer")).toBe("");
    expect(bearerToken("Bearer ")).toBe("");
  });
});

describe("authzResponse", () => {
  it("keeps the status an AuthzError carries", async () => {
    for (const status of [401, 403, 500]) {
      const res = authzResponse(new AuthzError(status, "nope"), CORS);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: "nope" });
    }
  });

  it("calls anything else a server fault, never a success", async () => {
    // A bug inside the check must not read as "you are signed in".
    const res = authzResponse(new Error("boom"), CORS);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });

  it("still answers when the thrown thing is not an Error at all", async () => {
    for (const thrown of ["a string", null, undefined, 42, { some: "object" }]) {
      const res = authzResponse(thrown, CORS);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("Authentication failed.");
    }
  });

  it("is never a 2xx, whatever it is handed", () => {
    for (const thrown of [new AuthzError(401, "x"), new Error("y"), "z", null, 0]) {
      expect(authzResponse(thrown, CORS).status).toBeGreaterThanOrEqual(400);
    }
  });

  it("carries the cors headers through, so the browser can read the refusal", () => {
    const res = authzResponse(new AuthzError(403, "staff only"), CORS);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("never returns null, which is the regression that would re-open 18 functions", () => {
    for (const thrown of [new AuthzError(401, "x"), new Error("y"), undefined]) {
      expect(authzResponse(thrown, CORS)).toBeInstanceOf(Response);
    }
  });
});

describe("AuthzError", () => {
  it("is an Error and keeps its status and message", () => {
    const e = new AuthzError(403, "Moburst staff only.");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(403);
    expect(e.message).toBe("Moburst staff only.");
  });
});
