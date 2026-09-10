import { describe, expect, it } from "vitest";
import { parseRpcBody, readToolResult } from "../../../supabase/functions/_shared/higgsfield/mcp";

describe("parseRpcBody", () => {
  it("reads a plain JSON response", () => {
    expect(parseRpcBody("application/json", '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}').result).toEqual({ ok: true });
  });

  it("reads the answering frame out of an SSE stream", () => {
    // The server may narrate progress before the result; the frame that
    // carries result or error is the one we want, not the last line.
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"generate_image"}]}}',
      "",
    ].join("\n");
    expect(parseRpcBody("text/event-stream", body).result.tools[0].name).toBe("generate_image");
  });

  it("survives a truncated frame in the stream", () => {
    const body = 'data: {"jsonrpc":"2.0","id":1,"resu\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":1}}\n';
    expect(parseRpcBody("text/event-stream", body).result).toEqual({ ok: 1 });
  });

  it("returns null when there is nothing to read", () => {
    expect(parseRpcBody("application/json", "not json")).toBeNull();
    expect(parseRpcBody("text/event-stream", "")).toBeNull();
  });
});

describe("readToolResult", () => {
  it("prefers structured content", () => {
    const r = readToolResult({ structuredContent: { id: "abc" }, content: [{ type: "text", text: "ignored" }] });
    expect(r.data).toEqual({ id: "abc" });
    expect(r.text).toBe("ignored");
  });

  it("parses JSON hiding in a text block", () => {
    const r = readToolResult({ content: [{ type: "text", text: '{"results":[{"id":"job-1"}]}' }] });
    expect((r.data as any).results[0].id).toBe("job-1");
  });

  it("keeps prose as text and reports an error result", () => {
    const r = readToolResult({ isError: true, content: [{ type: "text", text: "model_disabled" }] });
    expect(r.data).toBeNull();
    expect(r.text).toBe("model_disabled");
    expect(r.isError).toBe(true);
  });
});
