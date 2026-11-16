import { describe, expect, it, vi } from "vitest";
import { fetchPublic, isExpiringCdnUrl, isPubliclyFetchable, socialPlatformOf } from "../../../supabase/functions/_shared/net/safeUrl";

describe("isPubliclyFetchable", () => {
  it("allows the permalinks this actually has to fetch", () => {
    for (const u of [
      "https://www.instagram.com/p/abc123/",
      "https://www.instagram.com/reel/abc123/",
      "https://www.tiktok.com/@brand/video/7123456789",
      "https://www.facebook.com/brand/posts/123",
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      "https://www.youtube.com/watch?v=abc",
      "https://scontent.cdninstagram.com/v/t51/123.jpg",
      "http://example.com/image.png",
    ]) {
      expect(isPubliclyFetchable(u), u).toBe(true);
    }
  });

  it("refuses cloud metadata, the classic target", () => {
    expect(isPubliclyFetchable("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isPubliclyFetchable("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
  });

  it("refuses loopback in every spelling", () => {
    for (const u of [
      "http://localhost/",
      "http://localhost:8000/admin",
      "http://127.0.0.1/",
      "http://127.1.2.3/",
      "http://[::1]/",
      "http://app.localhost/",
    ]) {
      expect(isPubliclyFetchable(u), u).toBe(false);
    }
  });

  it("refuses every private IPv4 range", () => {
    for (const u of [
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://192.168.1.1/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
    ]) {
      expect(isPubliclyFetchable(u), u).toBe(false);
    }
  });

  it("allows public addresses that merely look adjacent to private ones", () => {
    // 172.15 and 172.32 are outside 172.16.0.0/12; 11.x and 9.x are public.
    for (const u of ["http://172.15.0.1/", "http://172.32.0.1/", "http://11.0.0.1/", "http://9.9.9.9/"]) {
      expect(isPubliclyFetchable(u), u).toBe(true);
    }
  });

  it("refuses private IPv6 and IPv4-mapped IPv6", () => {
    // The URL parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1, so the dotted
    // form never reaches the check and the hextets have to be unpacked.
    for (const u of [
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[fd12:3456::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::ffff:192.168.0.1]/",
    ]) {
      expect(isPubliclyFetchable(u), u).toBe(false);
    }
  });

  it("still allows a public address written as IPv4-mapped IPv6", () => {
    expect(isPubliclyFetchable("http://[::ffff:8.8.8.8]/")).toBe(true);
  });

  it("refuses internal-looking suffixes", () => {
    for (const u of ["http://db.internal/", "http://printer.local/"]) {
      expect(isPubliclyFetchable(u), u).toBe(false);
    }
  });

  it("refuses any scheme that is not http or https", () => {
    for (const u of ["file:///etc/passwd", "gopher://x/", "ftp://x/", "data:text/html,hi", "javascript:alert(1)"]) {
      expect(isPubliclyFetchable(u), u).toBe(false);
    }
  });

  it("refuses nonsense rather than throwing", () => {
    for (const u of ["", "   ", "not a url", null, undefined, "http://"]) {
      expect(isPubliclyFetchable(u as any)).toBe(false);
    }
  });
});

describe("socialPlatformOf", () => {
  it("names the network from the parsed host", () => {
    expect(socialPlatformOf("https://www.instagram.com/p/abc/")).toBe("instagram");
    expect(socialPlatformOf("https://youtu.be/abc123456")).toBe("youtube");
    expect(socialPlatformOf("https://x.com/a/status/1")).toBe("x");
    expect(socialPlatformOf("https://m.facebook.com/a/posts/1")).toBe("facebook");
  });

  it("does not mistake another site for a social post", () => {
    expect(socialPlatformOf("https://netflix.com/a")).toBeNull();
    expect(socialPlatformOf("https://evil.example/instagram.com/p/abc")).toBeNull();
    expect(socialPlatformOf("https://notinstagram.com/p/abc")).toBeNull();
    expect(socialPlatformOf("http://169.254.169.254/instagram.com")).toBeNull();
  });
});

describe("isExpiringCdnUrl", () => {
  it("accepts the networks' signed CDN hosts and Sprout's media host", () => {
    for (const u of [
      "https://scontent-lhr8-1.cdninstagram.com/v/a.jpg",
      "https://scontent.xx.fbcdn.net/v/a.jpg",
      "https://lookaside.fbsbx.com/lookaside/crawler/a.jpg",
      "https://media.licdn.com/dms/image/a.jpg",
      "https://p16-sign.tiktokcdn-us.com/a.jpg",
      "https://network-media.sproutsocial.com/abc",
    ]) expect(isExpiringCdnUrl(u), u).toBe(true);
  });

  it("refuses any other host, whatever the file name says", () => {
    expect(isExpiringCdnUrl("https://example.org/scontent-1.jpg")).toBe(false);
    expect(isExpiringCdnUrl("https://example.org/a/fbcdn.net/x.jpg")).toBe(false);
    expect(isExpiringCdnUrl("http://169.254.169.254/scontent-1.jpg")).toBe(false);
  });
});

describe("fetchPublic", () => {
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

  it("refuses a private address without sending a request", async () => {
    const send = vi.fn();
    await expect(fetchPublic("http://169.254.169.254/", {}, send as never)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("checks every redirect hop before sending to it", async () => {
    const send = vi.fn(async (u: string) => (u === "https://example.com/" ? redirect("http://169.254.169.254/latest") : new Response("secret")));
    await expect(fetchPublic("https://example.com/", {}, send as never)).rejects.toThrow();
    expect(send.mock.calls.map((c) => c[0])).toEqual(["https://example.com/"]);
  });

  it("follows a public redirect and returns the final response", async () => {
    const send = vi.fn(async (u: string) => (u === "https://a.example/" ? redirect("/b") : new Response("ok")));
    const r = await fetchPublic("https://a.example/", {}, send as never);
    expect(await r.text()).toBe("ok");
    expect(send.mock.calls[1][0]).toBe("https://a.example/b");
  });

  it("refuses a public name that resolves to a private address, without sending", async () => {
    const send = vi.fn();
    const resolve = vi.fn(async () => ["169.254.169.254"]);
    await expect(fetchPublic("https://169.254.169.254.nip.io/", {}, send as never, 5, resolve)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a private IPv6 answer too", async () => {
    const send = vi.fn();
    await expect(fetchPublic("https://v6.example/", {}, send as never, 5, async () => ["93.184.216.34", "fd00::1"])).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("resolves every redirect hop, not only the first", async () => {
    const send = vi.fn(async (u: string) => (u === "https://a.example/" ? redirect("https://rebind.example/x") : new Response("secret")));
    const resolve = async (h: string) => (h === "rebind.example" ? ["10.0.0.5"] : ["93.184.216.34"]);
    await expect(fetchPublic("https://a.example/", {}, send as never, 5, resolve)).rejects.toThrow();
    expect(send.mock.calls.map((c) => c[0])).toEqual(["https://a.example/"]);
  });

  it("fetches a name that resolves only to public addresses", async () => {
    const send = vi.fn(async () => new Response("ok"));
    const r = await fetchPublic("https://a.example/", {}, send as never, 5, async () => ["93.184.216.34", "2606:2800:220:1::1"]);
    expect(await r.text()).toBe("ok");
  });

  // Residual, recorded: the name is resolved here and again by the fetch, so a
  // record that changes between the two lookups (DNS rebinding) is not caught.
  // Where the runtime has no resolveDns, the name check does nothing and the
  // literal-address check still applies. Supabase's edge runtime is Deno and
  // provides resolveDns, which is the resolver used when none is passed.
  it("uses the runtime's own resolveDns when no resolver is passed", async () => {
    const resolveDns = vi.fn(async (_host: string, type: string) => (type === "A" ? ["10.0.0.5"] : []));
    vi.stubGlobal("Deno", { resolveDns });
    try {
      const send = vi.fn();
      await expect(fetchPublic("https://wildcard.example/", {}, send as never)).rejects.toThrow();
      expect(resolveDns).toHaveBeenCalledWith("wildcard.example", "A");
      expect(resolveDns).toHaveBeenCalledWith("wildcard.example", "AAAA");
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
