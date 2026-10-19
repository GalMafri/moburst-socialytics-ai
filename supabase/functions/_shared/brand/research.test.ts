import { describe, expect, it } from "vitest";
import { extractImageUrls, logoOnPage, parseBrandReply, siteTextExcerpt, visionImageType } from "./research";

const BASE = "https://www.example.com";

describe("logoOnPage", () => {
  it("takes the logo the site's schema.org data names first", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Organization","logo":{"@type":"ImageObject","url":"https://cdn.example.com/logotype.png"}}]}</script>
      <header><img src="/hero.jpg"></header>`;
    expect(logoOnPage(html, BASE)).toEqual({ url: "https://cdn.example.com/logotype.png" });
  });
  it("then the first image in the header, never a press logo further down the page", () => {
    const html = `<header><a href="/"><img alt="Bader Law" srcset="/_next/logo-baderlaw.png 1x"></a></header>${"<p>text</p>".repeat(4000)}<img class="press-logo" src="/bloomberg.avif">`;
    expect(logoOnPage(html, BASE)).toEqual({ url: "https://www.example.com/_next/logo-baderlaw.png" });
    const press = `<header><nav>Menu</nav></header>${"<p>text</p>".repeat(4000)}<img class="logo" src="/bloomberg.avif">`;
    expect(logoOnPage(press, BASE)).toBeNull();
  });
  it("keeps an inline SVG marked as the logo, and falls back to the touch icon", () => {
    expect(logoOnPage(`<header><svg class="site-logo" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg></header>`, BASE)).toMatchObject({ svg: expect.stringContaining("<path") });
    expect(logoOnPage(`<link rel="apple-touch-icon" href="/icon.png"><body></body>`, BASE)).toEqual({ url: "https://www.example.com/icon.png" });
  });
});

describe("parseBrandReply", () => {
  it("splits the brand identity from the headquarters and the language", () => {
    const r = parseBrandReply('{"primary_color":"#112233","secondary_color":"#445566","accent_color":"#778899","font_family":"Inter","visual_style":"v","logo_description":"l","tone_of_voice":"t","design_elements":"d","background_style":"b","headquarters":{"city":"Atlanta","region":"GA","country":"US"},"site_language":"en"}', [], { fonts: null, themeColor: null });
    expect(r.identity).toEqual({ primary_color: "#112233", secondary_color: "#445566", accent_color: "#778899", font_family: "Inter", visual_style: "v", logo_description: "l", tone_of_voice: "t", design_elements: "d", background_style: "b" });
    expect(r.headquarters).toEqual({ city: "Atlanta", region: "GA", country: "US" });
    expect(r.language).toBe("en");
  });
  it("reads no headquarters the site does not state, and builds an identity from the code's colors when the reply is unreadable", () => {
    expect(parseBrandReply('{"primary_color":"#112233","headquarters":null}', [], { fonts: null, themeColor: null }).headquarters).toBeNull();
    const fallback = parseBrandReply("sorry", [{ hex: "#abcdef", source: "css", confidence: "high" }], { fonts: "Lato, serif", themeColor: null });
    expect(fallback.identity).toMatchObject({ primary_color: "#abcdef", font_family: "Lato", logo_description: "Not read from the site" });
  });
});

describe("siteTextExcerpt", () => {
  it("puts the footer first, where a business states its address", () => {
    expect(siteTextExcerpt("<body><h1>We build apps</h1><footer>1250 Broadway, New York, NY 10001</footer></body>")).toBe("Footer: 1250 Broadway, New York, NY 10001\nPage: We build apps");
  });
});

describe("vision images", () => {
  it("tells the format from the file's own bytes and leaves out what the model cannot read", () => {
    const head = (...b: number[]) => new Uint8Array([...b, ...new Array(20).fill(0)]);
    expect(visionImageType(head(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(visionImageType(head(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(visionImageType(head(0x47, 0x49, 0x46, 0x38))).toBe("image/gif");
    expect(visionImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    // Bader Law's logo strip, 19 Oct 2026: AVIF served with no content type.
    expect(visionImageType(new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))).toBeNull();
    expect(visionImageType(head(0x42, 0x4d))).toBeNull(); // BMP
    expect(visionImageType(head(0x00, 0x00, 0x01, 0x00))).toBeNull(); // ICO
  });

  it("reads the organization's own schema.org logo first, never a press badge from the page", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization","logo":{"@type":"ImageObject","url":"https://example.com/logotype.png"}}</script></head>
      <body><header><a href="/"><img class="site-logo" src="/brand.svg" alt="Example"></a></header>
      <section class="as-seen-in"><img class="logo" src="https://cdn.example.com/bloomberg-1.avif" alt="Bloomberg logo"></section></body></html>`;
    const urls = extractImageUrls(html, "https://example.com/").map((i) => i.url);
    expect(urls[0]).toBe("https://example.com/logotype.png");
    expect(urls).not.toContain("https://cdn.example.com/bloomberg-1.avif");
    expect(urls).toContain("https://example.com/brand.svg");
  });
});
