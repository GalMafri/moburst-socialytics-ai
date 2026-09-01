import { describe, it, expect, vi } from "vitest";
import {
  classifyPollResponse,
  HiggsfieldError,
  isTerminal,
  jitterMs,
  nextPollDelay,
  POLL_INITIAL_DELAY_MS,
  POLL_MAX_DELAY_MS,
  pollUntilTerminal,
  submit,
  uploadInput,
} from "../../../supabase/functions/_shared/higgsfield/client";

const CREDS = { keyId: "kid", keySecret: "ksec" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const instantSleep = () => Promise.resolve();
const noJitter = () => 0;

describe("poll policy primitives", () => {
  it("widens the delay by 1.5x up to the 10s ceiling", () => {
    let d = POLL_INITIAL_DELAY_MS;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      d = nextPollDelay(d);
      seen.push(d);
    }
    expect(seen[0]).toBe(3000);
    expect(seen[1]).toBe(4500);
    expect(seen[2]).toBe(6750);
    expect(seen[3]).toBe(10000); // capped
    expect(Math.max(...seen)).toBe(POLL_MAX_DELAY_MS);
  });

  it("jitter stays within [0, 500)", () => {
    expect(jitterMs(() => 0)).toBe(0);
    expect(jitterMs(() => 0.999)).toBeLessThan(500);
  });

  it("classifies poll responses per the documented retry table", () => {
    expect(classifyPollResponse(200)).toBe("done");
    expect(classifyPollResponse(401)).toBe("abort");
    expect(classifyPollResponse(404)).toBe("abort");
    expect(classifyPollResponse(500)).toBe("continue");
    expect(classifyPollResponse(503)).toBe("continue");
  });

  it("knows the four terminal states and only those", () => {
    for (const s of ["completed", "failed", "nsfw", "canceled"]) expect(isTerminal(s)).toBe(true);
    for (const s of ["queued", "in_progress", "", undefined]) expect(isTerminal(s as string)).toBe(false);
  });
});

describe("submit", () => {
  it("POSTs the model path with Key auth and returns the submission", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "queued",
        request_id: "r1",
        status_url: "https://api.higgsfield.ai/requests/r1/status",
        cancel_url: "https://api.higgsfield.ai/requests/r1/cancel",
      }),
    );

    const out = await submit("/higgsfield-ai/soul/v2/standard", { prompt: "x" }, {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(out.request_id).toBe("r1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard");
    expect(init.headers.Authorization).toBe("Key kid:ksec");
  });

  it("appends hf_webhook url-encoded when a webhook is requested", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ status: "queued", request_id: "r1", status_url: "s", cancel_url: "c" }),
    );
    await submit("/m", { prompt: "x" }, {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      webhookUrl: "https://x.supabase.co/functions/v1/higgsfield-webhook?t=abc",
    });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain("hf_webhook=");
    expect(url).toContain(encodeURIComponent("?t=abc"));
  });

  it("maps the concurrency 400 to a typed, user-explainable error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Maximum number of concurrent requests (4) has been reached" }), {
        status: 400,
      }),
    );
    const err = await submit("/m", {}, {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HiggsfieldError);
    expect(err.code).toBe("concurrency_exhausted");
    expect(err.userMessage).toMatch(/limit/i);
  });

  it("maps 403 not_enough_credits to insufficient_credits with a clear message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "not_enough_credits" }), { status: 403 }),
    );
    const err = await submit("/m", {}, {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(err.code).toBe("insufficient_credits");
    expect(err.userMessage).toMatch(/credits/i);
  });

  it("maps 401 to unauthorized", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    const err = await submit("/m", {}, {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(err.code).toBe("unauthorized");
  });
});

describe("pollUntilTerminal", () => {
  it("keeps polling through non-terminal states and returns the completed body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "queued", request_id: "r1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "in_progress", request_id: "r1" }))
      .mockResolvedValueOnce(
        jsonResponse({ status: "completed", request_id: "r1", images: [{ url: "https://cdn/x.jpg" }] }),
      );

    const out = await pollUntilTerminal("https://s/r1", {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: instantSleep,
      randomImpl: noJitter,
      timeoutMs: 60_000,
    });
    expect(out.images?.[0].url).toBe("https://cdn/x.jpg");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries through 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", request_id: "r1", video: { url: "v" } }));
    const out = await pollUntilTerminal("https://s/r1", {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: instantSleep,
      randomImpl: noJitter,
      timeoutMs: 60_000,
    });
    expect(out.video?.url).toBe("v");
  });

  it("aborts immediately on 404 without exhausting the timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const err = await pollUntilTerminal("https://s/r1", {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: instantSleep,
      randomImpl: noJitter,
      timeoutMs: 60_000,
    }).catch((e) => e);
    expect(err.code).toBe("not_found");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws moderated for nsfw and generation_failed for failed", async () => {
    const nsfw = vi.fn().mockResolvedValue(jsonResponse({ status: "nsfw", request_id: "r1" }));
    const e1 = await pollUntilTerminal("https://s/r1", {
      credentials: CREDS,
      fetchImpl: nsfw as unknown as typeof fetch,
      sleepImpl: instantSleep,
      randomImpl: noJitter,
      timeoutMs: 60_000,
    }).catch((e) => e);
    expect(e1.code).toBe("moderated");

    const failed = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "failed", request_id: "r1", error: "GPU melted" }));
    const e2 = await pollUntilTerminal("https://s/r1", {
      credentials: CREDS,
      fetchImpl: failed as unknown as typeof fetch,
      sleepImpl: instantSleep,
      randomImpl: noJitter,
      timeoutMs: 60_000,
    }).catch((e) => e);
    expect(e2.code).toBe("generation_failed");
    expect(e2.message).toContain("GPU melted");
  });

  it("times out at the application ceiling", async () => {
    // Fresh Response per call — a Response body is single-use.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ status: "queued", request_id: "r1" })));
    // Sleeps are instant but `waited` accumulates the *intended* pause, so a
    // low ceiling exhausts after a handful of iterations.
    const err = await pollUntilTerminal("https://s/r1", {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: instantSleep,
      randomImpl: noJitter,
      timeoutMs: 5_000,
    }).catch((e) => e);
    expect(err.code).toBe("timeout");
  });
});

describe("uploadInput", () => {
  it("requests a ticket, PUTs with the returned headers, never leaks auth to storage", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          public_url: "https://cdn/in.jpg",
          upload_url: "https://storage/presigned",
          content_type: "image/jpeg",
          upload_headers: { "Content-Type": "image/jpeg", "x-amz-tagging": "retention=temporary" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const url = await uploadInput(new Uint8Array([1, 2, 3]), "image/jpeg", {
      credentials: CREDS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(url).toBe("https://cdn/in.jpg");
    const [, putInit] = fetchImpl.mock.calls[1];
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers["x-amz-tagging"]).toBe("retention=temporary");
    expect(putInit.headers.Authorization).toBeUndefined();
  });
});
