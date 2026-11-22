// @vitest-environment node
// What a hosted sandbox session's state reads as (sandbox.ts, checkScript),
// over a fake Managed Agents API.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ModelBusy } from "../../../functions/_shared/media/modelBusy";

let sandbox: typeof import("../../../functions/_shared/video/sandbox");
beforeAll(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "test-key" : undefined) } };
  sandbox = await import("../../../functions/_shared/video/sandbox");
});
afterEach(() => vi.unstubAllGlobals());

/** The API answering the session and its events as given. */
function api(session: Record<string, unknown>, events: unknown[]) {
  vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(String(url).includes("/events") ? { data: events } : { id: "s1", ...session }), { status: 200 }));
}
const asked = { type: "user.message", content: [{ type: "text", text: "<script>..." }] };
const said = (text: string) => ({ type: "agent.message", content: [{ type: "text", text }] });

describe("checkScript", () => {
  it("reads a session still at work as running", async () => {
    api({ status: "running" }, []);
    expect(await sandbox.checkScript("s1")).toEqual({ state: "running" });
  });

  it("reads an idle session that has not started its turn as running (its container is starting)", async () => {
    api({ status: "idle" }, [asked]);
    expect(await sandbox.checkScript("s1")).toEqual({ state: "running" });
  });

  it("reads a session that ended its turn without an answer as failed", async () => {
    // QA 22 Nov 2026 (P53-04): it was read as running on every check, so the join waited on it until the request's limit.
    api({ status: "idle", stop_reason: { type: "end_turn" } }, [asked, { type: "agent.tool_use", name: "bash" }, { type: "agent.tool_result" }]);
    expect(await sandbox.checkScript("s1")).toMatchObject({ state: "failed" });
  });

  it("reads a stop for any other reason with no answer as failed", async () => {
    api({ status: "idle", stop_reason: { type: "max_tokens" } }, [asked]);
    expect(await sandbox.checkScript("s1")).toEqual({ state: "failed", reason: "The sandbox stopped: max_tokens" });
  });

  it("reads the last answer of a session that ended its turn", async () => {
    api({ status: "idle", stop_reason: { type: "end_turn" } }, [asked, said("working"), said("COMPOSED 500000 8.0 1")]);
    expect(await sandbox.checkScript("s1")).toEqual({ state: "finished", reply: "COMPOSED 500000 8.0 1" });
  });
});

describe("the sandbox busy or briefly down", () => {
  for (const status of [429, 500, 503, 529]) {
    it(`is a wait (ModelBusy) when it answers ${status}`, async () => {
      // QA 22 Nov 2026 (P54-02): an outage of a few passes after the clip was paid for spent the job's tries and ended the video.
      vi.stubGlobal("fetch", async () => new Response("overloaded", { status }));
      const e = await sandbox.checkScript("s1").catch((x) => x);
      expect(e).toBeInstanceOf(ModelBusy);
      expect(e.message).toContain(String(status));
    });
  }

  it("is a plain error for a refusal (404)", async () => {
    vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
    const e = await sandbox.checkScript("s1").catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(ModelBusy);
  });
});
