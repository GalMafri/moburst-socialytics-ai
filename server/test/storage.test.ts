// @vitest-environment node
// server/test/storage.test.ts
//
// Reading and writing pictures through signed storage URLs (12 Nov 2026),
// against a fake fetch keyed by URL, so no network is used.

import { describe, expect, it } from "vitest";
import { PUBLIC_DEFAULTS } from "../../public-env.ts";
import { PICTURE_CALL_TIMEOUT_MS } from "../../supabase/functions/_shared/picture/contract.ts";
import { fetchBytes, inStorage, PRODUCT_STORAGE, putBytes, STORAGE_TIMEOUT_MS, StorageError } from "../src/storage.ts";

const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

/** A body that records whether anyone started reading it (no eager pull: highWaterMark 0). */
function watchedBody(bytes: Uint8Array, seen: { read: boolean }): ReadableStream<Uint8Array> {
  return new ReadableStream(
    {
      pull(controller) {
        seen.read = true;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

/** A body that keeps sending chunks of the given size, and counts how many it sent. */
function endlessBody(chunk: number, sent: { chunks: number }): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      sent.chunks++;
      controller.enqueue(new Uint8Array(chunk));
    },
  });
}

describe("fetchBytes", () => {
  const seen = { read: false };
  const sent = { chunks: 0 };
  const fake = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://store.test/get/ok") return new Response(BYTES, { status: 200 });
    if (url === "https://store.test/get/huge") return new Response(watchedBody(BYTES, seen), { headers: { "content-length": String(64 * 1024 * 1024 + 1) } });
    if (url === "https://store.test/get/growing") return new Response(endlessBody(1024, sent));
    if (url === "https://store.test/get/offline") throw new TypeError("fetch failed");
    if (url === "https://store.test/get/down") return new Response("bad gateway", { status: 502 });
    if (url === "https://store.test/get/slow-down") return new Response("too many", { status: 429 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  async function storageError(p: Promise<unknown>): Promise<StorageError> {
    try {
      await p;
    } catch (e) {
      return e as StorageError;
    }
    throw new Error("expected the read to fail");
  }

  it("marks a read that storage could not serve right now (network, 429, 5xx) as transient, and a missing object as not", async () => {
    expect((await storageError(fetchBytes("https://store.test/get/offline", fake))).transient).toBe(true);
    expect((await storageError(fetchBytes("https://store.test/get/down", fake))).transient).toBe(true);
    expect((await storageError(fetchBytes("https://store.test/get/slow-down", fake))).transient).toBe(true);
    const missing = await storageError(fetchBytes("https://store.test/get/missing", fake));
    expect(missing.transient).toBe(false);
    expect(missing.message).toBe("A picture could not be read from storage.");
    expect((await storageError(fetchBytes("https://store.test/get/huge", fake))).transient).toBe(false);
  });

  it("marks a body cut off while it was read as transient", async () => {
    const cut = (async () => new Response(new ReadableStream({ pull(c) { c.error(new TypeError("terminated")); } }))) as typeof fetch;
    const e = await storageError(fetchBytes("https://store.test/get/cut", cut));
    expect(e.message).toBe("A picture could not be read from storage.");
    expect(e.transient).toBe(true);
  });

  it("returns the bytes of a 200 answer", async () => {
    const got = await fetchBytes("https://store.test/get/ok", fake);
    expect(Buffer.from(got).equals(Buffer.from(BYTES))).toBe(true);
  });

  it("names a missing object in the product's words", async () => {
    await expect(fetchBytes("https://store.test/get/missing", fake)).rejects.toThrow(StorageError);
    await expect(fetchBytes("https://store.test/get/missing", fake)).rejects.toThrow("A picture could not be read from storage.");
  });

  it("names a fetch that fails outright in the same words", async () => {
    await expect(fetchBytes("https://store.test/get/offline", fake)).rejects.toThrow("A picture could not be read from storage.");
  });

  it("refuses a picture larger than 64 MB from its Content-Length, before reading it", async () => {
    await expect(fetchBytes("https://store.test/get/huge", fake)).rejects.toThrow("A picture is larger than 64 MB.");
    expect(seen.read).toBe(false);
  });

  it("stops reading a body that grows past the cap, and refuses it", async () => {
    await expect(fetchBytes("https://store.test/get/growing", fake, 10 * 1024)).rejects.toThrow("A picture is larger than 64 MB.");
    expect(sent.chunks).toBeGreaterThan(10);
    expect(sent.chunks).toBeLessThan(15);
  });
});

describe("where the service reads and writes", () => {
  it("is the product's own storage, from the repository's public values", () => {
    expect(PRODUCT_STORAGE).toBe(`${PUBLIC_DEFAULTS.VITE_SUPABASE_URL}/storage/v1/`);
  });

  it("takes a link only when it is an https link under the storage address", () => {
    const base = "https://store.test/storage/v1/";
    expect(inStorage("https://store.test/storage/v1/object/sign/b/a.png?token=t", base)).toBe(true);
    for (const link of ["https://store.test/storage/v1", "https://store.test/storage/v1/../x", "https://store.test/other/x", "https://STORE.test.example/storage/v1/x", "https://a@store.test/storage/v1/x", "http://store.test/storage/v1/x", "https://store.test:444/storage/v1/x", "", "x"]) {
      expect(inStorage(link, base), link).toBe(false);
    }
  });

  it("gives storage less time than the worker gives the whole call", () => {
    expect(STORAGE_TIMEOUT_MS).toBeLessThan(PICTURE_CALL_TIMEOUT_MS);
  });

  it("follows no redirect and carries the call's time limit on a read and on a write", async () => {
    const seen: RequestInit[] = [];
    const fake = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(BYTES, { status: 200 });
    }) as typeof fetch;
    const limit = AbortSignal.timeout(60_000);
    await fetchBytes("https://store.test/get/ok", fake, undefined, limit);
    await putBytes("https://store.test/put/ok", BYTES, "image/png", fake, limit);
    expect(seen.map((init) => init.redirect)).toEqual(["error", "error"]);
    expect(seen.map((init) => init.signal)).toEqual([limit, limit]);
  });

  it("counts a read or a write stopped by the time limit as storage not answering right now", async () => {
    const stalled = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    await expect(fetchBytes("https://store.test/get/ok", stalled, undefined, AbortSignal.timeout(20))).rejects.toMatchObject({ message: "A picture could not be read from storage.", transient: true });
    await expect(putBytes("https://store.test/put/ok", BYTES, "image/png", stalled, AbortSignal.timeout(20))).rejects.toMatchObject({ message: "A picture could not be stored.", transient: true });
  });
});

describe("putBytes", () => {
  it("PUTs with the content type and x-upsert, and names a refused upload", async () => {
    const calls: { url: string; method: string | undefined; contentType: string | null; upsert: string | null; body: Buffer }[] = [];
    const fake = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), method: init?.method, contentType: headers.get("content-type"), upsert: headers.get("x-upsert"), body: Buffer.from(await new Response(init?.body).arrayBuffer()) });
      return new Response("{}", { status: String(input).endsWith("/refused") ? 403 : 200 });
    }) as typeof fetch;

    await putBytes("https://store.test/put/ok", BYTES, "image/png", fake);
    expect(calls[0]).toMatchObject({ url: "https://store.test/put/ok", method: "PUT", contentType: "image/png", upsert: "true" });
    expect(calls[0].body.equals(Buffer.from(BYTES))).toBe(true);

    await expect(putBytes("https://store.test/put/refused", BYTES, "image/jpeg", fake)).rejects.toThrow(StorageError);
    await expect(putBytes("https://store.test/put/refused", BYTES, "image/jpeg", fake)).rejects.toThrow("A picture could not be stored.");
  });

  it("names an upload whose fetch fails outright in the same words", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(putBytes("https://store.test/put/ok", BYTES, "image/png", offline)).rejects.toThrow("A picture could not be stored.");
    await expect(putBytes("https://store.test/put/ok", BYTES, "image/png", offline)).rejects.toMatchObject({ transient: true });
  });

  it("marks an upload storage could not take right now (5xx) as transient, and a refused one (4xx) as not", async () => {
    const answer = (status: number) => (async () => new Response("x", { status })) as typeof fetch;
    await expect(putBytes("https://store.test/put/ok", BYTES, "image/png", answer(503))).rejects.toMatchObject({ message: "A picture could not be stored.", transient: true });
    await expect(putBytes("https://store.test/put/ok", BYTES, "image/png", answer(400))).rejects.toMatchObject({ message: "A picture could not be stored.", transient: false });
  });
});
