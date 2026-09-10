import { describe, expect, it } from "vitest";
import { mediaKind, mediaLabel } from "@/components/competitive/PostVisual";

describe("mediaKind", () => {
  it("names the creative a post actually used", () => {
    expect(mediaKind("carousel_album")).toBe("carousel");
    expect(mediaKind("reel")).toBe("video");
    expect(mediaKind("photo")).toBe("image");
  });

  it("tells a LinkedIn document post from a plain text post", () => {
    // Both used to come back as "text", so a PDF carousel looked like a status.
    expect(mediaKind("document")).toBe("document");
    expect(mediaKind("pdf_carousel")).toBe("document");
    expect(mediaKind("status")).toBe("text");
  });

  it("tells a shared link from a picture", () => {
    expect(mediaKind("link")).toBe("link");
    expect(mediaKind("article")).toBe("link");
  });

  it("falls back to the platform when the type says nothing", () => {
    expect(mediaKind(null, "https://www.tiktok.com/@brand/video/1")).toBe("video");
    expect(mediaKind("", "https://www.instagram.com/reel/abc/")).toBe("video");
  });

  it("gives every kind a label a person would use", () => {
    expect(mediaLabel("document")).toBe("Document");
    expect(mediaLabel("link")).toBe("Link");
    expect(mediaLabel("carousel")).toBe("Carousel");
  });
});
