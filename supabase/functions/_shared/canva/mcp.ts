// supabase/functions/_shared/canva/mcp.ts
//
// Canva MCP, the only Canva surface that edits a design's layers (the REST
// API cannot delete an element or replace its text). Socialytics' own Canva
// app has Canva MCP turned on in the Developer Portal, so the app's user
// token is accepted here as it is by the REST API.
//
// Canva's MCP answers some calls, initialize most often, with a transient
// 500 that succeeds when sent again; calls are resent with backoff. It also
// fails far more often when one account holds several editing sessions at
// once, so callers run their edits one at a time (see canva-finish).

const URL_MCP = "https://mcp.canva.com/mcp";
const RETRIES = 5;

export class CanvaMcp {
  private session: string | null = null;
  private nextId = 1;
  constructor(private token: string) {}

  private async post(body: Record<string, unknown>): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.session) headers["Mcp-Session-Id"] = this.session;
      const resp = await fetch(URL_MCP, { method: "POST", headers, body: JSON.stringify(body) });
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

  async init(): Promise<void> {
    await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "socialytics", version: "1" } } });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Call a tool and return its parsed text result; a tool error throws. */
  async call(name: string, args: Record<string, unknown>): Promise<any> {
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
