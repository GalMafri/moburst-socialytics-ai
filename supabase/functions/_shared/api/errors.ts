/**
 * Errors the API answers with. One shape for every failure:
 * { error: { code, message, details? } }. The code is what a machine
 * caller switches on; the message is for a person reading a log.
 */
export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "rate_limited"
  | "demo_capacity"
  | "job_running"
  | "unprocessable"
  | "upstream_failed"
  | "internal";

export class ApiError extends Error {
  constructor(public status: number, public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
export const invalid = (message: string, details?: unknown) => new ApiError(400, "invalid_request", message, details);
export const unauthorized = (message = "A valid API key is required") => new ApiError(401, "unauthorized", message);
export const forbidden = (message: string) => new ApiError(403, "forbidden", message);

export function errorBody(e: ApiError): { error: { code: ErrorCode; message: string; details?: unknown } } {
  const error: { code: ErrorCode; message: string; details?: unknown } = { code: e.code, message: e.message };
  if (e.details !== undefined) error.details = e.details;
  return { error };
}
