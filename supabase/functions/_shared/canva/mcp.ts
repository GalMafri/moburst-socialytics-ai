// supabase/functions/_shared/canva/mcp.ts
//
// Canva MCP, the only Canva surface that edits a design's layers (the REST
// API cannot delete an element or replace its text). Socialytics' own Canva
// app has Canva MCP turned on in the Developer Portal, so the app's user
// token is accepted here as it is by the REST API.
//
// Canva's MCP answers some calls, initialize most often, with a transient
// 500 that succeeds when sent again; calls are resent with backoff. Edits may
// run side by side: calls are paced under Canva's published per-tool limits
// (pace.ts), and a 429 is resent with bounded backoff, as Canva's usage
// policy asks. When Canva stays busy, CanvaBusy tells the caller to wait for
// a later pass rather than fail.

import { CANVA_PACE, CanvaBusy, Pace, backoffMs } from "./pace.ts";

const URL_MCP = "https://mcp.canva.com/mcp";
const RETRIES = 5;
/** Longest a call waits for its turn under the pace before handing the step back to a later pass. */
const MAX_PACE_WAIT_MS = 12_000;
/** How long until a call to this tool may go (0: go now, and it is counted). */
export type PaceFn = (tool: string) => Promise<number>;
/** Without a shared count, sessions in one process share this one. */
const localPace = new Pace(CANVA_PACE);
const inMemory: PaceFn = (tool) => Promise.resolve(localPace.tryTake(tool));

export class CanvaMcp {
  private session: string | null = null;
  private nextId = 1;
  /** pace: the shared count of Canva calls (the worker passes one kept in the database, so every request sees it). */
  constructor(private token: string, private pace: PaceFn = inMemory) {}

  private async post(body: Record<string, unknown>): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.session) headers["Mcp-Session-Id"] = this.session;
      const resp = await fetch(URL_MCP, { method: "POST", headers, body: JSON.stringify(body) });
      if (resp.status === 429) {
        const wait = backoffMs(resp.headers.get("Retry-After"), attempt);
        await resp.body?.cancel();
        if (attempt >= RETRIES || wait > MAX_PACE_WAIT_MS) throw new CanvaBusy(wait, String((body.params as any)?.name ?? body.method));
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (resp.status >= 500 && attempt < RETRIES) {
        await resp.body?.cancel();
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const text = await resp.text();
      if (!resp.ok) throw new Error(`Canva MCP ${String(body.method)} ${resp.status}: ${text.slice(0, 300)}`);
      const sid = resp.headers.get("Mcp-Session-Id");
      if (sid) this.session = sid;
      if (!text.trim()) return null;
      if (text.trimStart().startsWith("{")) return JSON.parse(text);
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const d = JSON.parse(line.slice(5).trim());
        if (d.result !== undefined || d.error !== undefined) return d;
      }
      return null;
    }
  }

  /** End the session on Canva's side; a session left open counts against the account. */
  async close(): Promise<void> {
    if (!this.session) return;
    try {
      await fetch(URL_MCP, { method: "DELETE", headers: { Authorization: `Bearer ${this.token}`, "Mcp-Session-Id": this.session } });
    } catch {
      // Best effort: Canva expires idle sessions on its own.
    }
    this.session = null;
  }

  get ready(): boolean {
    return !!this.session;
  }

  async init(): Promise<void> {
    await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "socialytics", version: "1" } } });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Call a tool and return its parsed text result; a tool error throws. */
  async call(name: string, args: Record<string, unknown>): Promise<any> {
    // Wait for this tool's turn under Canva's per-minute limit; past a short
    // wait, the step goes back to a later pass.
    for (;;) {
      const wait = await this.pace(name);
      if (!wait) break;
      if (wait > MAX_PACE_WAIT_MS) throw new CanvaBusy(wait, name);
      await new Promise((r) => setTimeout(r, wait));
    }
    const d = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } });
    if (d?.error) throw new Error(`Canva ${name}: ${JSON.stringify(d.error).slice(0, 300)}`);
    const res = d?.result;
    if (!res || res.isError) throw new Error(`Canva ${name} failed: ${JSON.stringify(res ?? d).slice(0, 400)}`);
    for (const part of res.content ?? []) {
      if (part.type === "text") {
        try { return JSON.parse(part.text); } catch { return part.text; }
      }
    }
    return res.structuredContent ?? res;
  }
}
