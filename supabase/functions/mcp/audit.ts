/**
 * What the connector records and how often a person may call it. Each tool
 * call writes one row to the API's api_requests table (method MCP, the tool
 * as the path), never the arguments or the result, and counts toward the
 * API's limit of 120 calls a minute, kept per person by mcp_rate_touch. A
 * save that wrote something names it in target (writes.ts).
 */
import type { AuditRow } from "../_shared/api/core.ts";

export const RATE_LIMIT_PER_MINUTE = 120;

export interface McpAuditRow extends AuditRow {
  user_id: string;
  oauth_client_id: string | null;
  /** What a save wrote (a note id, a post key, a section key, a deck id); null for a read or a save that wrote nothing. Never the text. */
  target: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function auditRow(a: { tool: string; status: number; durationMs: number; clientId?: unknown; errorCode: string | null; userId: string; oauthClientId: string | null; ip: string | null; target?: string | null }): McpAuditRow {
  return {
    key_id: null, method: "MCP", path: `mcp/${a.tool}`, status: a.status, duration_ms: Math.max(0, Math.round(a.durationMs)),
    client_id: typeof a.clientId === "string" && UUID.test(a.clientId) ? a.clientId : null, job_id: null, ip: a.ip, error_code: a.errorCode,
    user_id: a.userId, oauth_client_id: a.oauthClientId, target: typeof a.target === "string" && a.target ? a.target.slice(0, 300) : null,
  };
}

/** The verdict on a person's nth call this minute. */
export function rateCheck(count: number, now: Date): { ok: true } | { ok: false; retryAfter: number; text: string } {
  if (count <= RATE_LIMIT_PER_MINUTE) return { ok: true };
  const retryAfter = Math.max(1, 60 - now.getUTCSeconds());
  return { ok: false, retryAfter, text: `Too many requests this minute. Try again in ${retryAfter} ${retryAfter === 1 ? "second" : "seconds"}.` };
}
