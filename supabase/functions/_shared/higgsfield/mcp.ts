// supabase/functions/_shared/higgsfield/mcp.ts
//
// Enough of an MCP client to call one server's tools from an edge function.
//
// Higgsfield's best models are reachable through its MCP and not through the
// REST API this account holds, so the app speaks MCP. This is not a general
// implementation: it does the streamable-HTTP handshake, keeps the session
// id, calls tools, and reads results. No SSE resumption, no server-initiated
// requests, no sampling — none of which a generation call needs.
//
// Every request goes through the paying desk (_shared/paid): the server's
// answers say nothing about cost, so nothing is recorded per call; a
// generation's credits are recorded once it completes (paid.record, where
// the caller sees it finish).
//
// Kept free of Deno globals at module scope so vitest can exercise the
// framing logic with a stub fetch (the test meter, supabase/tests/paid).

import type { CostContext } from "../cost/context.ts";
import { paid } from "../paid/index.ts";

/** The MCP endpoint, under Higgsfield's MCP host (cost/registry.ts). */
export const MCP_PATH = "/mcp";

export interface McpToolResult {
  /** Whatever the tool returned as structured content, when it did. */
  data: unknown;
  /** The text blocks, joined — several Higgsfield tools answer in text. */
  text: string;
  isError: boolean;
}

export class McpError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}

const PROTOCOL_VERSION = "2025-06-18";

/**
 * One JSON-RPC response out of a streamable-HTTP body.
 *
 * The server may answer with `application/json` or with an SSE stream whose
 * `data:` lines carry the frames. Both shapes appear in practice, so both
 * are read here rather than at every call site.
 */
export function parseRpcBody(contentType: string, body: string): any {
  if (contentType.includes("text/event-stream")) {
    const frames: any[] = [];
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        frames.push(JSON.parse(payload));
      } catch {
        // A partial frame is not fatal; the useful one is usually the last.
      }
    }
    // The response to our request is the frame carrying result or error.
    return frames.reverse().find((f) => f && (f.result !== undefined || f.error !== undefined)) ?? frames.pop() ?? null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export interface McpClientOptions {
  /** Who the session's calls are for. */
  cost: CostContext;
  /** The endpoint under the provider's MCP host; MCP_PATH unless a test says otherwise. */
  path?: string;
  /** The team's OAuth access token (oauth.ts); the desk leaves an Authorization the caller set as it is. */
  accessToken: string;
  /** Per-request budget. Edge functions die at 150s, so never near that. */
  timeoutMs?: number;
  /** A fresh access token in place of one the server rejected (higgsfield/oauth.ts, higgsfieldMcp): a 401 is answered with one renewal and the request sent again. */
  renewToken?: (rejected: string) => Promise<string>;
}

export class McpClient {
  private readonly cost: CostContext;
  private readonly path: string;
  private token: string;
  private readonly renewToken?: (rejected: string) => Promise<string>;
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(opts: McpClientOptions) {
    this.cost = opts.cost;
    this.path = opts.path ?? MCP_PATH;
    this.token = opts.accessToken;
    this.renewToken = opts.renewToken;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      // Both, because the server picks: a plain JSON body or an SSE stream.
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  private async send(method: string, params?: unknown, isNotification = false): Promise<any> {
    const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) payload.params = params;
    if (!isNotification) payload.id = this.nextId++;

    const post = () => paid.fetch(this.cost, "higgsfield", this.path, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    let resp = await post();
    // QA 22 Nov 2026: a token that ran out during a long call is renewed once and the same request sent again.
    if (resp.status === 401 && this.renewToken) {
      await resp.body?.cancel();
      const rejected = this.token;
      this.token = await this.renewToken(rejected);
      if (this.token !== rejected) resp = await post();
    }

    const sid = resp.headers.get("Mcp-Session-Id") || resp.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (resp.status === 401) {
      throw new McpError("Higgsfield rejected the session. The team account needs linking again.", 401);
    }
    // A notification is answered with 202 and no body.
    if (isNotification) return null;

    const text = await resp.text();
    if (!resp.ok) throw new McpError(`MCP ${method} failed (${resp.status}): ${text.slice(0, 300)}`, resp.status);

    const frame = parseRpcBody(resp.headers.get("content-type") || "", text);
    if (!frame) throw new McpError(`MCP ${method} returned nothing readable`);
    if (frame.error) throw new McpError(`MCP ${method}: ${frame.error.message || JSON.stringify(frame.error)}`, frame.error.code);
    return frame.result;
  }

  /** Handshake. Safe to call repeatedly; only the first one talks. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "socialytics", version: "1.0" },
    });
    await this.send("notifications/initialized", undefined, true);
    this.initialized = true;
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    await this.initialize();
    const result = await this.send("tools/list", {});
    return (result?.tools || []) as Array<{ name: string; description?: string }>;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.initialize();
    const result = await this.send("tools/call", { name, arguments: args });
    return readToolResult(result);
  }
}

/** A tools/call result, flattened to the two things callers use. */
export function readToolResult(result: any): McpToolResult {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
  let data: unknown = result?.structuredContent ?? null;
  if (data == null && text) {
    // Several Higgsfield tools answer with JSON inside a text block.
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { data, text, isError: result?.isError === true };
}
