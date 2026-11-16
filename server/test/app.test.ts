// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { PICTURE_CALL_HEADER } from "../../supabase/functions/_shared/picture/contract.ts";

const CALL = "5f0c2f6e-8a1b-4c3d-9e2f-1a2b3c4d5e6f";
const NOT_ALLOWED = { ok: false, reason: "Not allowed." };

/** An app whose database answers every claim the same way (an Error is thrown), with what it was asked and what it logged. */
function door(answer: boolean | Error) {
  const lines: Record<string, unknown>[] = [];
  const claimCall = vi.fn(async (_id: string) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const app = createApp({ claimCall, log: (line) => lines.push(line), now: () => 1_700_000_000_000 });
  return { app, claimCall, lines };
}
const post = (headers: Record<string, string>) => ({ method: "POST", headers, body: "{}" });

describe("the server's door", () => {
  it("answers health with no call, without asking the database, and says nothing but its name", async () => {
    const { app, claimCall } = door(true);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "socialytics-server" });
    expect(claimCall).not.toHaveBeenCalled();
  });

  it("refuses a picture call that carries no call id, without asking the database", async () => {
    const { app, claimCall } = door(true);
    const res = await app.request("/api/picture/finish", post({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(NOT_ALLOWED);
    expect(claimCall).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a UUID, without asking the database", async () => {
    const { app, claimCall } = door(true);
    const malformed = ["", "wrong", "s3cret", `${CALL}0`, CALL.slice(1), CALL.replace(/-/g, ""), `${CALL} or true`, `{${CALL}}`, "x".repeat(4096)];
    for (const id of malformed) {
      const res = await app.request("/api/picture/finish", post({ [PICTURE_CALL_HEADER]: id }));
      expect(res.status, id).toBe(401);
      expect(await res.json()).toEqual(NOT_ALLOWED);
    }
    expect(claimCall).not.toHaveBeenCalled();
  });

  it("refuses a call the database does not claim: unknown, already claimed, or opened too long ago", async () => {
    const { app, claimCall, lines } = door(false);
    const res = await app.request("/api/picture/finish", post({ [PICTURE_CALL_HEADER]: CALL }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(NOT_ALLOWED);
    expect(claimCall).toHaveBeenCalledTimes(1);
    expect(claimCall).toHaveBeenCalledWith(CALL);
    // The route never ran; the door says once that the claim came back false, so a refused job leaves a trace, and never the id.
    expect(lines).toEqual([{ at: new Date(1_700_000_000_000).toISOString(), route: "/api/picture/finish", ok: false, reason: "The database did not claim the call." }]);
    expect(JSON.stringify(lines)).not.toContain(CALL);
  });

  it("logs nothing for a call with no id or a malformed one, which anyone on the internet can send", async () => {
    const { app, lines } = door(true);
    await app.request("/api/picture/finish", post({}));
    await app.request("/api/picture/finish", post({ [PICTURE_CALL_HEADER]: "wrong" }));
    expect(lines).toEqual([]);
  });

  it("lets a claimed call through to its route, and claims it before it reads the body", async () => {
    let read = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        read = true;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const lines: Record<string, unknown>[] = [];
    const claimCall = vi.fn(async () => {
      expect(read).toBe(false);
      return true;
    });
    const app = createApp({ claimCall, log: (line) => lines.push(line) });
    const res = await app.request(new Request("http://service.test/api/picture/finish", { method: "POST", headers: { [PICTURE_CALL_HEADER]: CALL }, body, duplex: "half" } as RequestInit));
    // The route ran: it read the body and found it not well formed.
    expect(res.status).toBe(400);
    expect(read).toBe(true);
    expect(claimCall).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
  });

  it("takes an id in capitals as the same id", async () => {
    const { app, claimCall } = door(true);
    const res = await app.request("/api/picture/finish", post({ [PICTURE_CALL_HEADER]: CALL.toUpperCase() }));
    expect(res.status).toBe(400);
    expect(claimCall).toHaveBeenCalledWith(CALL.toUpperCase());
  });

  it("answers 503 when the database does not answer, so the worker waits, and logs why without the id", async () => {
    const { app, lines } = door(new Error("The database answered 502."));
    const res = await app.request("/api/picture/finish", post({ [PICTURE_CALL_HEADER]: CALL }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "The picture service could not check the call with the database." });
    expect(lines).toEqual([{ at: new Date(1_700_000_000_000).toISOString(), route: "/api/picture/finish", ok: false, reason: "The picture service could not check the call with the database.", error: "The database answered 502." }]);
    expect(JSON.stringify(lines)).not.toContain(CALL);
  });

  it("checks every other path under /api the same way, and answers an unknown route as JSON", async () => {
    const closed = door(true);
    expect((await closed.app.request("/api/nothing")).status).toBe(401);
    expect(closed.claimCall).not.toHaveBeenCalled();

    const { app } = door(true);
    const res = await app.request("/api/nothing", { headers: { [PICTURE_CALL_HEADER]: CALL } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "Unknown route." });
  });
});
