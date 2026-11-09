import { describe, expect, it } from "vitest";
import { mediaKind, mediaLabel, postType } from "@/components/competitive/PostVisual";

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

  it("never reads a LinkedIn company update as a link post: Sprout's category first, the network prefix dropped, link as a whole word", () => {
    const update = { post_type: "LINKEDIN_COMPANY_UPDATE", permalink: "https://www.linkedin.com/feed/update/urn:li:activity:1" };
    expect(mediaKind("LINKEDIN_COMPANY_UPDATE")).toBe("image");
    expect(mediaLabel(mediaKind(postType(update), update.permalink))).toBe("Image");
    expect(mediaLabel(mediaKind(postType({ ...update, content_category: "VIDEO" }), update.permalink))).toBe("Video");
    expect(mediaLabel(mediaKind(postType({ ...update, content_category: "DOCUMENT" }), update.permalink))).toBe("Document");
    expect(mediaKind("linkedin")).toBe("image");
    expect(mediaKind("INSTAGRAM_MEDIA", "https://www.instagram.com/reel/abc/")).toBe("video");
  });

  it("still reads a real link post as one", () => {
    expect(mediaLabel(mediaKind(postType({ content_category: "LINK", post_type: "LINKEDIN_COMPANY_UPDATE" })))).toBe("Link");
    expect(mediaKind("FACEBOOK_LINK")).toBe("link");
    expect(mediaKind("link_share")).toBe("link");
    expect(postType({ content_category: "", post_type: "FACEBOOK_POST", media_type: "photo" })).toBe("FACEBOOK_POST");
    expect(postType({ media_type: "carousel" })).toBe("carousel");
    expect(postType(null)).toBe("");
  });
});
