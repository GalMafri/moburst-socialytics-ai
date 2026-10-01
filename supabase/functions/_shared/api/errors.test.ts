import { describe, it, expect } from "vitest";
import { ApiError, errorBody, invalid, notFound } from "./errors";

describe("ApiError", () => {
  it("carries status, code and message into the error body", () => {
    const e = new ApiError(409, "conflict", "already there", { id: "x" });
    expect(errorBody(e)).toEqual({ error: { code: "conflict", message: "already there", details: { id: "x" } } });
  });
  it("leaves details out when there are none", () => {
    expect(errorBody(notFound("Run"))).toEqual({ error: { code: "not_found", message: "Run not found" } });
    expect(notFound("Run").status).toBe(404);
  });
  it("builds a 400 for invalid input", () => {
    const e = invalid("client_name is required", { field: "client_name" });
    expect(e.status).toBe(400);
    expect(e.code).toBe("invalid_request");
  });
});
