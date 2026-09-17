import { describe, expect, it } from "vitest";
import { isPubliclyFetchable } from "../../../supabase/functions/_shared/net/safeUrl";

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
